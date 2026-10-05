# Architecture Decision Records (ADRs)

## ADR: Polyglot Architecture — Go for Location/Matching, TypeScript for Trip/Notification

**Decision:** Location Service and Matching Service (plus their shared libraries: geospatial, matching-algorithms) are implemented in Go. Trip Service and Notification Service are implemented in TypeScript.

**Why:** Location Service handles high-frequency, small, bursty writes and Matching Service is a long-running EC2 process maintaining a warm in-memory geo index and running a batching loop — both benefit from Go's low memory footprint, fast Lambda cold starts, and native goroutine-based concurrency for the matching loop's internal work. Trip Service and Notification Service are I/O-orchestration and state-machine-shaped services where TypeScript's fast iteration speed, rich AWS SDK v3 ergonomics, and lower boilerplate for REST/WebSocket handler code are the better fit.

**Cost of this choice:** two toolchains to maintain; DTOs shared between the Go and TypeScript halves (e.g., the Trip DTO that both Trip Service (TS) and Matching Service (Go) need to understand) must be kept in sync manually across shared/models/go and shared/models/ts, since there is no shared runtime to enforce this automatically. This is an explicit, accepted trade-off — mitigated by treating shared/models as a single conceptual source of truth with parallel implementations, and by keeping the DTOs intentionally small and stable.

## ADR: Geohash Precision — 5 Characters

**Decision:** Geohash prefix indexing in the platform uses a standard precision of 5 characters (~4.9km × 4.9km bounding box at the equator).

**Why:**

- **Trade-off Analysis:**
  - _Coarser precision (4 characters, ~39km × 19.5km):_ Results in excessively large spatial partition buckets containing hundreds of drivers, creating severe false positives and CPU overhead during candidate filtering in the Matching Service.
  - _Finer precision (6 characters, ~1.2km × 0.6km):_ Cells are too small for typical urban ride dispatch radii (3–5km), requiring excessive adjacent cell lookups (querying 9+ cells per dispatch query) and generating unnecessary fan-out I/O on driver location queries.
  - _5 characters (~4.9km × 4.9km):_ Offers an optimal baseline balance where a single cell plus its immediate 8 neighbors naturally covers a ~15km × 15km urban dispatch envelope with bounded candidate counts.
- **Revision Strategy:** 5 characters is chosen as the starting architectural default, subject to tuning and revision based on real-world load testing and density profiles across different metropolitan areas.

_Note on Implementation Language:_ This geospatial library is implemented in Go per the polyglot architecture ADR, as it is consumed exclusively by the Go-based Location Service and Matching Service.

## ADR: Single-Table Design with Three GSIs

**Decision:** The platform uses a DynamoDB Single-Table Design with a single table and three Global Secondary Indexes (GSI1, GSI2, GSI3).

**Why:**

- **Single-Table Rationale:** Consolidating Driver Locations, Trips, and Assignment pointers into one table eliminates multi-table join round trips, allows atomic multi-entity transaction commits (`TransactWriteItems`), and enables all primary operational query patterns to be satisfied by the primary key or one of three targeted GSIs. At the project's scale, this provides predictable single-digit millisecond latency while minimizing provisioning and operational complexity.
- **Index Roles:**
  - **GSI1 (Geohash Driver Availability):** Serves spatial queries by geohash partition (`GSI1PK = "GEOHASH#<hash>"`), allowing Matching Service and dispatch queries to retrieve available drivers in a cell in a single query.
  - **GSI2 (Rider Trip History):** Queries all rides requested by a rider ordered by timestamp (`GSI2PK = "RIDER#<riderId>"`), satisfying trip history pagination.
  - **GSI3 (Driver Active Trip Guard):** Acts as a sparse index (`GSI3PK = "DRIVER#<driverId>"`) present only during an active trip, enabling immediate checks and conditional writes that enforce a driver can only have one active trip at a time.
- **Billing & Recovery Choices:**
  - `PAY_PER_REQUEST` (On-Demand) billing was selected to eliminate provisioned capacity estimation, handle bursty ride request spikes without throttling, and incur zero idle cost when traffic ceases.
  - `point_in_time_recovery` is disabled explicitly to avoid continuous backup storage charges within the AWS Free Tier and educational environment scope.

## ADR: Parallel Go/TS DynamoDB Wrappers with Matching Semantics

**Decision:** Maintain parallel DynamoDB client wrappers in Go (`shared/dynamo-client/go`) and TypeScript (`shared/dynamo-client/ts`) exposing the identical conceptual API and error-handling contract.

**Why:**

- **Unified Mental Model:** Both wrappers expose matching method signatures and semantics (`GetItem`/`getItem`, `PutItem`/`putItem`, `Query`/`query`, `ConditionalPutItem`/`conditionalPutItem`). This guarantees engineers working across the Go and TypeScript boundaries share a single mental model for data access without language-specific API drift.
- **First-Class Conditional Write Semantics:** In ride dispatch and driver matching, racing to atomically claim an available driver is an expected, frequent operational outcome rather than an exceptional error. Both wrappers intercept DynamoDB's `ConditionalCheckFailedException` and return a clean boolean `false` (with `nil` error in Go or without throwing an exception in TypeScript). Genuinely exceptional failures (network timeouts, validation errors, IAM denial, throttling) continue to propagate as standard errors/exceptions in both languages.

## ADR: Auth Stub, Not Production Auth

**Decision:** The platform uses a lightweight, symmetric-secret (HS256) JWT issuance endpoint (`POST /auth/token`) and custom API Gateway Lambda authorizer (`services/auth-stub/`) with no underlying user database, password management, or refresh token flow.

**Why:**

- **Demonstration Without Over-Engineering:** As a cloud-native portfolio and demonstration system, the objective is to model authenticated API contracts, role-based authorization guards (`driver` vs `rider`), and principal-context propagation through API Gateway into downstream microservices without building or maintaining a complete identity provider.
- **Production Replacement:** In a production architecture, this stub would be replaced by Amazon Cognito User Pools or an enterprise Identity Provider (e.g., Auth0, Okta) utilizing asymmetric key pairs (RS256/ES256) and OpenID Connect (OIDC). Full identity management, credential storage, and password reset workflows are intentionally out of scope.

## ADR: GSI1SK Consistency Between Location and Status Updates

**Decision:** Adopt a read-then-write pattern in Location Service to maintain `GSI1SK` consistency across separate location heartbeat and availability status updates.

- On every location update (`POST /drivers/{id}/location`), the handler first executes `GetItem` on the driver's location record (`PK = "DRIVER#<driverId>"`, `SK = "LOCATION"`) to fetch their current status (defaulting to `"offline"` if no prior record exists), then writes the complete item with the status folded into `GSI1SK = "DRIVER#<status>#<driverID>"`.
- On every status update (`PUT /drivers/{id}/status`), the handler executes `GetItem` to recover the driver's current coordinates (`lat`, `lng`), defaulting to `(0.0, 0.0)` if no prior location heartbeat has been emitted yet. It then recomputes the 5-character geohash and writes back the complete record with updated `GSI1PK`, `GSI1SK`, and `Status`.

**Why:**

- In DynamoDB single-table design, GSI1 indexes driver records by spatial geohash (`GSI1PK = "GEOHASH#<geohash>"`), enabling the Matching Service to query candidate drivers within a cell filtered by availability prefix (`GSI1SK begins_with "DRIVER#available#"`).
- Since incoming location requests carry only coordinates (`lat`, `lng`) and status requests carry only the status string (`status`), neither payload alone contains all attributes necessary to populate both `GSI1PK` and `GSI1SK`.
- Read-then-write ensures that each record written to DynamoDB remains self-contained, validly indexed in GSI1, and searchable by the Matching Service without requiring complex DynamoDB transactional writes across separate entities.

**Accepted Trade-off (Concurrency & Race Condition):**

- A benign race condition exists if a driver emits a status change (e.g., toggling from "offline" to "available") concurrently with a location heartbeat at the exact same millisecond. In that narrow window, the two reads could interleave and one write could overwrite the other's latest field until the next heartbeat arrives.
- Given driver heartbeats occur frequently (e.g. every 5–10 seconds) and driver status changes are relatively infrequent, this eventual convergence within one heartbeat interval is an acceptable trade-off compared to the operational complexity and performance overhead of distributed locking or multi-item transactions.

## ADR: Internal Service-to-Service Auth for the Matching→Trip Callback

**Decision:** The internal endpoint for assigning a driver to a ride (`POST /internal/rides/{id}/assign-driver`) is protected via a shared secret header (`x-internal-api-key`) verified against `process.env.INTERNAL_API_KEY`, rather than the user/driver JWT authorizer from Module 8 or AWS IAM SigV4.

**Why:**

- **Caller Context:** The caller is not a mobile client or end-user; it is an internal background daemon (the Go Matching Service executing on an EC2 instance within the VPC or private network).
- **Simplicity vs. Security:** While AWS IAM SigV4 or mutual TLS (mTLS) provide enterprise-grade service-to-service authentication, configuring SigV4 signing in Go for local LocalStack testing introduces significant client-side signing complexity and AWS credential management without architectural benefit for this demonstration portfolio.
- **Header Shared Secret:** An `x-internal-api-key` header checked at the handler entrance ensures unauthenticated external callers cannot invoke internal assignment endpoints, while keeping the client integration in the Go matching daemon completely standard HTTP with minimal boilerplate.
- **Production Evolution:** In a production multi-account AWS architecture, this endpoint would either reside on a private API Gateway inside an internal VPC with VPC endpoints and IAM authorization (`aws_iam` authorizer), or communicate asynchronously via an Amazon SQS queue or EventBridge event bus.

## ADR: One SNS Topic for All Notification-Worthy Events

**Decision:** Maintain a single SNS topic (`${project_name}-${environment}-match-events`) carrying both initial "driver matched" events and subsequent ride-status-change events that Notification Service needs to fan out to connected clients, rather than creating separate fine-grained topics per event type.

**Why:**

- **Single Downstream Consumer:** In the current platform architecture, Notification Service is the sole consumer of match and ride lifecycle transition events.
- **Low Overhead & Free-Tier Efficiency:** Creating multiple specialized SNS topics (e.g. `driver-matched-topic`, `ride-status-changed-topic`) introduces infrastructural complexity, requires additional IAM policies, and consumes unnecessary management overhead without architectural justification at this project's scale.
- **Filtering & Extensibility:** SNS message attributes allow consumers to perform client-side or subscription-level filtering if required. If a second, distinct consumer with independent filtering or strict access-boundary requirements is introduced in the future, this decision can be revisited to decompose the topic.

## ADR: SQS Visibility Timeout Sizing for Matching Service

**Decision:** Set `visibility_timeout_seconds = 30` on both `location-events` and `ride-request-events` standard SQS queues.

**Why:**

- **Workload Estimation:** A 30-second visibility timeout is sized around the Matching Service's worst-case processing envelope for a single message or small batch:
  1. Parsing and querying the in-memory geospatial candidate index (~1–5ms).
  2. Running the matching strategy (naive candidate selection or Hungarian assignment cost matrix computation, up to 100–500ms).
  3. Attempting an atomic DynamoDB conditional write to mark the driver as `busy`/`en_route` (~10–30ms).
  4. Performing a synchronous HTTP callback to Trip Service (`POST /internal/rides/{id}/assign-driver`) with network jitter and potential retries (up to 2–5 seconds).
- **Graceful Failure Buffer:** 30 seconds provides ample margin for transient network hiccups, HTTP retries, or execution pauses without risking premature visibility expiration (which would cause a duplicate consumer to pick up the same in-flight message prematurely).
- **Post-Module 28 Load Testing Revision:** This 30-second timeout is a deliberate starting baseline. It must be explicitly re-evaluated and tuned once Module 28's end-to-end load testing yields empirical, observed p99 message processing durations under realistic concurrent load.

## ADR: DynamoDB Streams Event Forwarder Decoupling

**Decision:** Decouple DynamoDB write mutations (driver locations and ride state updates) from SQS event ingestion using an asynchronous Lambda forwarder (`services/event-forwarder`) triggered by DynamoDB Streams (`NEW_AND_OLD_IMAGES`), rather than publishing directly to SQS inside the Location Service and Trip Service HTTP handlers.

**Why:**

- **Handler Latency & Resilience:** Location Service is optimized for high-frequency, bursty ingestion (driver telemetry). Publishing synchronously to SQS within the HTTP request lifecycle increases handler duration and introduces an external network failure point. If SQS experiences throttling or transient downtime, the API request would fail even though the state write was durable.
- **Transactional Consistency Without 2PC:** DynamoDB Streams captures every durable write committed to the database in guaranteed commit order per shard. This guarantees at-least-once delivery to downstream consumers without requiring distributed two-phase commits across DynamoDB and SQS.
- **Single Source of Truth:** Decoupling via Streams keeps the mutation handlers focused solely on business validation and persistence, allowing event schema translation and routing rules to evolve independently in the event forwarder.

## ADR: Partial Batch Failure Handling via ReportBatchItemFailures

**Decision:** Configure `function_response_types = ["ReportBatchItemFailures"]` on the DynamoDB Streams event source mapping and return an `events.DynamoDBEventResponse` tracking only failing record identifiers (`ItemIdentifier: record.EventID`).

**Why:**

- **Head-of-Line Blocking Prevention:** By default, if a Lambda consumer of a DynamoDB Stream throws an unhandled error, AWS Lambda retries the entire batch until retention expires or the maximum retry limit is hit, stalling all subsequent records on that shard.
- **Selective Retries:** With `ReportBatchItemFailures`, only the specific records that encountered an error (e.g. transient SQS delivery error) are marked for redelivery by AWS Lambda. Successfully forwarded or intentionally skipped records are committed and not reprocessed, eliminating redundant work and preventing head-of-line blocking.

## ADR: Claim-Then-Confirm Assignment, and What Happens When Confirm Fails

**Decision:** Driver assignment operates via a two-phase "claim-then-confirm" pattern. Matching Service first executes an optimistic conditional write to DynamoDB (`#status = :available` -> `"busy"`) to claim exclusive ownership of a candidate driver. Only after the claim succeeds does it issue a synchronous HTTP confirmation call (`POST /internal/rides/{id}/assign-driver`) to Trip Service. If the Trip Service confirmation call fails, Matching Service immediately attempts a compensating conditional write reverting the driver's status back to `"available"` (conditioned on `#status = :busy`).

**Why:**

- **Preventing Double Assignment (Optimistic Concurrency):** Multiple concurrent matching daemons or parallel evaluation loops could select the same geographically optimal driver for different riders. Requiring an atomic conditional claim in DynamoDB guarantees that only one matcher can transition a driver to `busy`. All competing matchers observe a conditional check failure (`ConditionalCheckFailedException` -> `(false, nil)`) and immediately fall back to their next nearest candidate.
- **Trip Service as Authority on Ride State:** Trip Service owns the ride lifecycle state machine. Matching Service cannot directly mutate ride state to `MATCHED` in DynamoDB because Trip Service enforces preconditions (e.g. verifying the ride has not been cancelled by the rider in the interim). Thus, a synchronous callback to Trip Service is necessary to finalize the assignment.

**Compensating Transaction & Failure Modes (What Happens When Confirm Fails):**

- **The Core Correctness Dilemma:** Between claiming the driver in DynamoDB and confirming the ride assignment in Trip Service, a distributed state boundary exists across two services. If the HTTP call to Trip Service fails (e.g. network timeout, 500 internal error, or 409 Conflict if the rider cancelled), the driver is left locked in `busy` status without an active trip.
- **Compensating Revert:** When Trip Service returns an error or fails to respond, Matching Service immediately executes a compensating write:
  ```
  ConditionalPutItem(Status = "available", condition = "#status = :busy")
  ```
  Conditioning the revert on `#status = :busy` ensures we only revert if the status has not been modified by another process. If the revert succeeds, the driver is safely returned to the available pool for subsequent dispatch cycles.
- **Known Limitation & Trade-off (Failed Revert):**
  If the compensation revert itself fails (e.g. network partition, DynamoDB throttling, or crash), the driver remains stuck in `busy` status. This is an accepted distributed systems trade-off for this architecture. Instead of introducing heavy distributed transaction coordinators (e.g. two-phase commit or a centralized Saga coordinator), this condition is logged at `ERROR` level with driver and ride identifiers. It is treated as a known, rare inconsistency to be resolved by the asynchronous TTL sweeper and state reconciliation daemon (Module 27).

## ADR: Local Testing Runs Matching Service as a Plain OS Process, Not Emulated EC2

**Decision:** During local development, CI runs, and automated integration tests against LocalStack, Matching Service executes as a plain background OS process (`nohup ... &` or direct binary invocation) configured via environment variables pointing to LocalStack endpoints, rather than provisioning a virtualized EC2 instance inside LocalStack.

**Why:**

- **LocalStack Community Tier Limitations:** LocalStack Community edition does not support full EC2 virtual machine execution. While mock EC2 control plane APIs exist in certain tiers, running genuine compute instances with networking, systemd, and process isolation requires LocalStack Pro or external Docker orchestration.
- **Fidelity of Application Logic:** Matching Service's core behavior depends on SQS polling, DynamoDB reads/writes, HTTP calls to Trip Service API Gateway, and in-memory geo-indexing. Running the compiled Go binary directly on the test host exercises the exact same SDK calls, network protocols, concurrency semantics, and configuration contract as a production systemd daemon, without artificial emulation overhead or slow VM bootstrap times.
- **Clear Separation of Concerns:** EC2 infrastructure code in `infra/modules/ec2-matching/` (IAM roles, egress-only security group, and `t2.micro` instance) is validated via `terraform validate` and `terraform fmt` and conditionally enabled for real AWS deployments (`count = var.environment == "local" ? 0 : 1`). Genuine EC2 provisioning and systemd service bootstrap are validated against real AWS in Module 29.

## ADR: Refactoring JWT Verification into a Shared Package

**Decision:** Extract the `verifyToken` function, along with its supporting types (`UserRole`, `DecodedToken`) and `AuthError` class, from `services/auth-stub/src/jwt-utils.ts` into a new shared npm workspace package `shared/auth/ts/`. `services/auth-stub` retains `signToken` and imports/re-exports `verifyToken` from `@ride-dispatch/auth`.

**Why:**

- **Just-in-Time Shared Code Extraction:** Prior to Module 20, `services/auth-stub` was the sole consumer of JWT logic in TypeScript (issuing tokens and validating them in its custom API Gateway authorizer). Rather than speculatively abstracting auth verification into a shared library early, extraction was deferred until a genuine second consumer emerged.
- **Notification Service as the Second Consumer:** In Module 20, Notification Service introduces a WebSocket `$connect` handler that must authenticate incoming client connections by verifying their bearer JWT before storing connection mappings. Notification Service is the first real second consumer of token verification in TypeScript.
- **Separation of Issuance vs. Verification:** `signToken` remains inside `services/auth-stub` because issuing authentication tokens is a privileged responsibility exclusive to the auth service. In contrast, verifying incoming tokens is a cross-cutting concern needed by any service accepting and validating user/driver requests directly.

## ADR: Self-Implemented Hungarian Algorithm

**Decision:** Implement the Hungarian algorithm (Kuhn-Munkres) for minimum-weight bipartite matching from first principles in Go (`shared/matching-algorithms/`), with no third-party package dependencies. Rectangular matrices are supported via dynamic sentinel-cost padding, and correctness is rigorously verified via an exhaustive brute-force permutation cross-check.

**Why:**

- **Zero Third-Party Dependencies (First-Principles Implementation):** Consistent with Module 5's geohash "build it yourself" precedent, implementing core foundational algorithms directly within the repository avoids external dependency vulnerabilities, version drift, and opaque black-box edge cases. This grants the team full control over numerical stability, memory allocations, and performance optimization in the batch matching loop.
- **O(n³) Time Complexity via Dual Potentials:** The implementation uses the standard augmenting-path-with-potentials (Kuhn-Munkres via dual variables `u` and `v`) formulation. For an $n \times n$ matrix, each augmenting path step finds an augmenting path and updates potentials in $O(n^2)$ time across $n$ stages, guaranteeing strict $O(n^3)$ worst-case time complexity.
- **Dynamic Sentinel Padding for Rectangular Matrices:**
  - Real-world ride dispatch is fundamentally rectangular: the number of ride requests $N$ rarely equals the number of available candidate drivers $M$.
  - Rather than padding with extreme values like `math.MaxFloat64` (which immediately overflows to `+Inf` or yields `NaN` during dual potential arithmetic: `cost[i][j] - u[i] - v[j]` and `delta` updates), the library dynamically computes:
    $$\text{sentinel} = 10 \times \max(|cost_{\max}|, 1.0) + 100.0$$
  - This ensures dummy row/column edges are strictly more expensive than any real assignment, guaranteeing that real driver-rider pairs are matched whenever possible while maintaining complete arithmetic safety and stability.
  - After solving, matches to dummy nodes are stripped (setting unassigned real rows to `-1`), and `totalCost` is accumulated exclusively from the original real costs.
- **Exhaustive Brute-Force Testing Guarantee:**
  - To prove mathematical correctness without relying on third-party libraries, the test suite implements an independent permutation-enumeration reference solver (`bruteForceOptimalCost`).
  - The property test generates over 100 randomized cost matrices (sizes 1×1 to 7×7) and proves that `Solve` consistently matches the absolute global minimum cost within floating-point tolerance ($10^{-9}$), while hand-crafted trap matrices prove it avoids local greedy choices.

## ADR: Batch Window Sizing and Graceful Degradation to Naive Matching

**Decision:** Matching Service introduces a dual-strategy architecture supporting both Module 18's per-request greedy matching (`MATCHING_STRATEGY=naive`, default) and a globally optimal batch matching strategy (`MATCHING_STRATEGY=batch`) using the self-implemented Hungarian algorithm. The batch matcher aggregates requests in an in-memory `Window` governed by `BATCH_WINDOW_MS` (default: 3000 ms) and `MAX_BATCH_SIZE` (default: 20 requests), with automatic graceful degradation to naive matching if batch optimization fails or exceeds deadline.

**Why:**

- **Batch Window Sizing (3000 ms / 20 requests):**
  - _Rider Wait Latency vs. Global Efficiency:_ In ride dispatch, waiting an additional 3 seconds before matching is imperceptible to riders waiting on an app confirmation screen, yet provides a critical aggregation window during peak periods. Accumulating concurrent ride requests across adjacent urban geohash cells allows global bipartite matching to eliminate greedy inefficiencies, achieving 20–30% lower total pickup mileage and reduced deadhead travel across the fleet.
  - _Cap at 20 Requests:_ A maximum batch size of 20 bounds the Hungarian algorithm's $O(n^3)$ matrix computation to $20^3 = 8,000$ operations (sub-millisecond runtime in Go), eliminating CPU spikes while ensuring bursty traffic flushes immediately without waiting for timer expiry.
- **In-Memory Window Buffer vs. SQS Redelivery Semantics:**
  - In naive mode, SQS retains message visibility until `processRideRequestMessage` finishes assignment. In batch mode, holding messages in SQS during the 3-second batch window risks visibility timeout expiry or race conditions with redrive loops.
  - When `MATCHING_STRATEGY=batch`, messages are acknowledged and deleted from SQS immediately upon insertion into `window.Add(...)`. The in-memory `Window` becomes the state holder during the batch duration. Graceful shutdown (`window.Stop()`) drains and flushes any pending buffered requests prior to process termination, preventing dropped rides.
- **Graceful Degradation to Naive Matching:**
  - Global batch optimization runs under a strict 1-second child context deadline (`flushCtx`).
  - If `BatchMatcher.FindMatches` fails due to context cancellation, deadline timeout, or empty driver pool (`ErrNoDriversAvailable`), `ProcessBatch` logs a warning and immediately falls back to iterating through every request in the batch using `NaiveNearestMatcher.FindMatch`, feeding the results to `assigner.Assign`.
  - This architecture guarantees that algorithm failure or extreme load never blocks ride dispatch: the system seamlessly degrades to greedy nearest matching, preserving platform uptime.
- **Fallback-Within-Fallback for Rectangular Batches:**
  - When concurrent ride requests exceed available nearby drivers ($N > M$), the rectangular Hungarian solver pairs excess requests to dummy columns (`assignment[i] == -1`).
  - Unassigned requests automatically fall back to individual naive nearest driver lookup. This ensures that losing the global optimization contest does not leave a rider without candidates if any reachable driver exists.

## ADR: A/B Comparison via Structured Logs, Not a Separate Metrics Store

**Decision:** Capture match-decision evaluation telemetry (`strategy`, `rideId`, `candidatesConsidered`, `assigned`, `chosenDistanceMeters`, `decisionDurationMs`, `batchSize`, `timestamp`, `logType = "match_decision"`) as structured JSON records emitted directly to stdout (`os.Stdout`), rather than introducing a separate dedicated metrics datastore or telemetry daemon.

**Why:**

- **Zero Operational & Infrastructure Overhead:**
  - Introducing a dedicated timeseries database (e.g., Prometheus/InfluxDB) or push-based metrics client (e.g., StatsD daemon) adds external infrastructure dependencies, connection pools, and network round trips to the critical path of ride dispatch.
  - Emitting structured newline-delimited JSON directly to stdout executes in sub-microsecond local time with minimal heap allocation, decoupling telemetry from external availability.
- **Decoupled Offline Analysis via CLI Tools:**
  - Emitting self-contained decision records enables lightweight, flexible offline analysis using standalone scripts (`scripts/analyze-match-decisions.js`) or standard Unix tools (`jq`, `grep`). Operators and developers can run comparative A/B quality and latency benchmarks from captured log streams without querying complex analytics engines.
- **Resilience Guarantee (Zero Crash Impact):**
  - Logging must never compromise or crash the core dispatch pipeline. `LogMatchDecision` handles serialization defensively, emitting plain-text fallback notices on error and ensuring matching decisions always complete regardless of log sink state.
- **Forward-Compatibility with CloudWatch Metrics (Modules 25 & 26):**
  - This decision serves as the foundational data contract for subsequent production telemetry. In Modules 25 and 26, CloudWatch Logs subscription filters, CloudWatch Metric Filters, or AWS Embedded Metric Format (EMF) can seamlessly aggregate these exact fields (`chosenDistanceMeters`, `decisionDurationMs`, `batchSize`) into dimensional CloudWatch metrics without requiring structural redesign of the Matching Service decision pipeline.

## ADR: zerolog (Go) and pino (TypeScript) for Structured Logging

**Decision:** Adopt `zerolog` for Go services (Location Service, Matching Service, DynamoDB Streams event forwarder) and `pino` for TypeScript services (Trip Service, Notification Service, auth stub), wrapped in shared packages (`shared/logging/go` and `shared/logging/ts`) exposing consistent APIs with correlation-ID scoping.

**Why:**

- **Lightweight & High Performance:** Both `zerolog` and `pino` are purpose-built for zero or minimal memory allocations, fast JSON serialization, and sub-millisecond execution times. They avoid heavy reflection, locks, and complex object allocation on the critical request path.
- **JSON-Native Output:** Both libraries natively produce newline-delimited JSON logs written directly to standard output (`os.Stdout` / `process.stdout`), seamlessly aligning with AWS CloudWatch Logs, Lambda log drivers, and container log aggregators without extra parsing or formatting filters.
- **Ecosystem Standard & Ergonomics:** `zerolog` is standard in modern Go cloud services, while `pino` is the benchmark for Node.js/TypeScript logging. Both support native contextual child loggers (`WithCorrelationID` in Go, `.child({ correlationId })` in TypeScript), enabling request-scoped tracing across handlers.
- **Shared Abstraction Layer:** By placing thin wrappers in `shared/logging/go` and `shared/logging/ts`, application handlers depend on uniform logging interfaces (`Info`, `Warn`, `Error`, `WithCorrelationID`/`withCorrelationId`), decoupling business logic from underlying logging library internals while keeping signatures idiomatic in both languages.

## ADR: CloudWatch EMF for Custom Metrics, No Separate Metrics Backend

**Decision:** Use the AWS CloudWatch Embedded Metric Format (EMF) specification to emit custom operational and business metrics directly through structured stdout log lines, rather than introducing a separate metrics backend (such as a StatsD daemon, Prometheus gateway, or calling the CloudWatch `PutMetricData` API directly).

**Why:**

- **Zero Additional API Calls or Network Overhead:** Emitting EMF metrics involves serializing a standardized JSON payload to standard output. CloudWatch Logs automatically ingests these log entries and extracts custom CloudWatch metrics asynchronously without the Lambda function or daemon making HTTP/HTTPS API calls to CloudWatch (`PutMetricData`). This completely eliminates network latency and avoids API rate limits or throttling on the critical request path.
- **Zero Additional Infrastructure & Free-Tier Efficiency:** A dedicated metrics backend (e.g., Prometheus, InfluxDB, Datadog agent) incurs hosting and maintenance overhead. EMF leverages existing CloudWatch Logs log groups, meaning metrics generation introduces zero new infrastructure and incurs no incremental cost beyond existing log ingestion at the project's free-tier-conscious scale.
- **Dual Metadata-Block-Plus-Flat-Fields Structure:** The shared libraries (`shared/logging/go` and `shared/logging/ts`) enforce the exact CloudWatch EMF dual structure: a top-level `_aws` directive containing `Timestamp`, `CloudWatchMetrics` array (with `Namespace`, `Dimensions` as `string[][]`, and `Metrics` as `[{Name, Unit}]`), coupled with flat sibling fields for all dimension key/values and metric name/values in the identical root JSON object.
- **Coexistence with Plain JSON Logs:** EMF custom metrics (`MatchAttempted`, `MatchSucceeded`, `MatchFailed`, `MatchDecisionDurationMs`) peacefully coexist alongside plain JSON diagnostic logs and Module 24's `match_decision` telemetry, allowing both native CloudWatch alarms/dashboards and offline script-based analysis.

## ADR: One Dashboard, Two DLQ-Depth Alarms — Minimal but Actionable Alerting

**Decision:** Provision a single centralized CloudWatch dashboard (`<project_name>-<environment>-platform-overview`) and exactly two high-priority metric alarms (`ride-request-dlq-depth` and `location-events-dlq-depth`) alerting to an SNS operations topic (`<project_name>-<environment>-ops-alerts`), rather than creating dozens of noisy per-function thresholds.

**Why:**

- **High-Signal, Low-Noise Alerting Philosophy:** In distributed microservice event-driven platforms, alerting on raw Lambda errors or transient latency spikes causes alert fatigue, as standard retries and exponential backoff frequently heal transient issues. Messages arriving in a Dead Letter Queue (DLQ), however, signify that an event has exhausted all retries (`maxReceiveCount = 5`) and failed permanently. A DLQ depth greater than zero (`threshold = 0`, `ApproximateNumberOfMessagesVisible > 0`) is an unambiguous indicator of systemic processing failures requiring engineer intervention.
- **Immediate Actionability:** The two DLQ alarms directly map to the platform's two core asynchronous data ingestion funnels: driver spatial heartbeats (`location-events-dlq`) and incoming ride dispatches (`ride-request-dlq`). Each alarm carries clear descriptions identifying the root queue, enabling on-call operators to immediately diagnose whether location indexing or the matching daemon is degrading.
- **Single-Pane-of-Glass Visibility:** Rather than fragmenting operational views across separate per-service screens, one unified CloudWatch dashboard combines:
  1. Service request and error volumes via custom EMF metrics (Location Service and Trip Service).
  2. Matching Service operational metrics (`MatchAttempted`, `MatchSucceeded`, `MatchFailed`) and A/B strategy latency (`naive` vs `batch` p99 and average duration).
  3. SQS queue and DLQ depths side-by-side (making accumulating backlogs instantly visible).
  4. Platform-wide Lambda invocations, errors, and p99 durations across all functions.
  5. DynamoDB single-table consumed capacity and throttling metrics.
- **Cost & Complexity Containment:** CloudWatch alarms and custom dashboards incur minor AWS charges outside the free tier. Limiting alarms to critical DLQs keeps the infrastructure completely manageable, cost-effective, and fully reproducible across both local emulation and production environments.

## ADR: System-Initiated MATCHED→REQUESTED Transition for Driver-Accept Timeouts

**Decision:** Implement an automated, scheduled background worker (`reassign-stale-matches`) that detects rides remaining in `MATCHED` state past a configured driver acceptance timeout (`DRIVER_ACCEPT_TIMEOUT_SECONDS`, default 60 seconds), resets their state back to `REQUESTED`, releases the assigned driver back to `available` status, and directly re-enqueues the ride request to the `ride-request-events` SQS queue.

**Why:**

- **Resolving the Abandoned Match Deadlock:**
  - When Matching Service matches a rider with a driver, the ride enters `MATCHED` state and the driver is marked `busy`. If the driver's device loses network connectivity, crashes, or the driver simply ignores the incoming dispatch prompt, the ride would remain stuck in limbo indefinitely without automated timeout handling.
  - The rider would wait forever without a ride, and the driver would remain permanently `busy`, locking out valuable supply.
- **Strictly System-Initiated Transition:**
  - Transitioning from `MATCHED` back to `REQUESTED` is reserved EXCLUSIVELY for this automated timeout reassignment job. Rider-facing and driver-facing handlers are explicitly prohibited by state machine validation from triggering this reverse transition.
- **Sparse GSI4 Query Efficiency:**
  - To avoid costly full-table scans at scale, a sparse secondary index (`GSI4PK = "STATE#MATCHED"`, `GSI4SK = updatedAt`) is introduced. Because DynamoDB indexes items only when the index attributes exist, GSI4 indexes solely active `MATCHED` rides. When a ride leaves `MATCHED` (accepted, cancelled, or timed out), `GSI4PK` and `GSI4SK` are removed.
- **Race Condition Prevention via Optimistic Concurrency:**
  - The transition uses DynamoDB conditional writes: `#state = :matched AND #updatedAt = :oldUpdatedAt`.
  - If a driver accepts the match (`DRIVER_EN_ROUTE`) or the rider cancels (`CANCELLED`) concurrently while the reassignment job is inspecting the ride, the conditional check fails gracefully. The job logs the concurrent modification and skips the ride without releasing the driver or double-enqueuing.
- **Direct SQS Re-enqueue vs DynamoDB Streams:**
  - Module 16's event-forwarder classifies DynamoDB Streams events: `ride-requested` events are emitted EXCLUSIVELY on table `INSERT` events with `state == "REQUESTED"`.
  - Because stale-match reassignment produces a DynamoDB `MODIFY` event (`MATCHED` -> `REQUESTED`), modifying the forwarder to capture update mutations would risk event loops or duplicate events on unrelated updates. Direct SQS enqueue strictly preserves event-forwarder classification invariants.
- **Polyglot Symmetry:**
  - Releasing the driver's reservation in TypeScript mirrors Go Matching Service's `RevertDriverClaim` conditional write logic, upholding the repository's convention of implementing identical conceptual patterns cleanly in each service's native language.

## ADR: Idempotency Audit Findings

**Decision:** Systematically audit every DynamoDB write path across the platform and document all concurrency control and idempotency mechanisms in `docs/idempotency-audit.md`.

**Why:**

- **Formal Verification of Data Integrity:**
  - In a distributed event-driven dispatch platform, race conditions between rider cancellations, concurrent driver assignments, GPS telemetry bursts, and WebSocket reconnects can cause split-brain states (e.g. one driver double-booked to two riders, or multiple drivers dispatched to a single trip).
  - A systematic audit documents every write operation, the specific conditional expressions employed (`attribute_not_exists`, `#state = :expected`, `#status = :available`), and the exact failure handling semantics (HTTP 409 Conflict vs idempotent replay vs retry).
- **Justified Divergence (LWW vs CAS):**
  - High-frequency telemetry (Location Service) and ephemeral socket tracking (Notification Service) deliberately avoid conditional checks in favor of idempotent overwrites and deletes. The audit formally articulates why last-write-wins is domain-appropriate for telemetry and why CAS locks are mandatory for trip reservations.
- **Audit Outcome:**
  - All write paths across Location Service, Trip Service, Matching Service, and Notification Service were verified to be strictly concurrency-safe, with zero unprotected multi-writer corruption vectors. Detailed analysis for each endpoint and method is preserved in [docs/idempotency-audit.md](idempotency-audit.md).
