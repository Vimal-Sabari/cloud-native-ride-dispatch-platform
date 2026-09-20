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
