# Cloud-Native Ride Dispatch & Matching Platform
### Complete End-to-End Implementation Blueprint

**Author's note (Principal Engineer perspective):** This document is written the way I'd write a design doc before greenlighting a project at work — scoped for one engineer, honest about trade-offs, and structured so that every decision has a "why" attached. Treat this as your single source of truth for the project. Update it as you build; a design doc that drifts from reality is worse than no design doc.

---

## 1. Project Scope and Objectives

### Objective
Build a backend platform that ingests real-time driver locations, matches ride requests to drivers using an optimization algorithm (not just "nearest driver"), and manages the full ride lifecycle — all deployed on AWS free tier using a small, defensible microservices architecture.

### Primary Learning Objectives
- Real-time/event-driven system design
- Geospatial data modeling without relying on a managed geo database
- Optimization algorithms under real-time constraints (batch matching)
- Microservices boundaries chosen for genuine reasons (not decomposition for its own sake)
- Cloud-native deployment with Infrastructure as Code
- Production concerns: idempotency, retries, observability, testing

### In Scope
- Driver location ingestion at moderate frequency (simulated, 1 update/1–2 sec/driver)
- Ride request → match → trip lifecycle state machine
- Two matching strategies: naive nearest-neighbor, and batch-optimal (Hungarian algorithm)
- Event-driven communication between services (SQS/SNS)
- Basic real-time notifications (WebSocket via API Gateway)
- Observability: structured logging, CloudWatch metrics/dashboards
- IaC via Terraform, CI/CD via GitHub Actions

### Out of Scope (explicitly, documented in README)
- Payments and billing
- Real road-network routing (turn-by-turn navigation) — approximated via cost function
- Full auth system (a lightweight token stub is enough; Cognito is optional/stretch)
- Multi-region / high availability beyond single-AZ
- Kubernetes — unjustified at this scale and would read as resume padding

---

## 2. Functional and Non-Functional Requirements

### Functional Requirements
| ID | Requirement |
|---|---|
| FR1 | Drivers can go online/offline and stream location updates |
| FR2 | System maintains a queryable index of available drivers by location |
| FR3 | Riders can request a ride with pickup/dropoff coordinates |
| FR4 | System matches ride requests to drivers using a configurable strategy |
| FR5 | Trip progresses through a defined state machine (requested → matched → en_route → in_progress → completed/cancelled) |
| FR6 | Riders and drivers receive real-time status updates |
| FR7 | System records trip history queryable per rider/driver |
| FR8 | Admin/operator can view system metrics (match latency, active drivers, queue depth) |

### Non-Functional Requirements
| ID | Requirement | Target |
|---|---|---|
| NFR1 | Match latency (naive) | < 500ms p95 |
| NFR2 | Match latency (batch window) | < 3s (bounded by batch window size) |
| NFR3 | No double-assignment of a driver to two trips | 100% (correctness > speed here) |
| NFR4 | Location update ingestion | Handle 100+ concurrent simulated drivers |
| NFR5 | Idempotency | Duplicate events must not corrupt state |
| NFR6 | Cost | Must run within AWS Free Tier (~$0–2/month) |
| NFR7 | Observability | All services emit structured logs + key metrics |
| NFR8 | Testability | Core algorithms unit-testable without AWS running |

---

## 3. High-Level Architecture

```
                         ┌────────────────────────────┐
                         │   Local Simulators           │
                         │   (Driver + Rider clients)    │
                         └──────────────┬───────────────┘
                                        │ HTTPS / WSS
                         ┌──────────────▼───────────────┐
                         │   API Gateway (REST + WS)      │
                         └───┬──────────┬──────────┬─────┘
                             │          │          │
                 ┌───────────▼──┐  ┌────▼─────┐ ┌──▼────────────┐
                 │ Location Svc   │  │ Trip Svc   │ │ WS Connection   │
                 │ (Lambda)         │  │ (Lambda)    │ │ Mgmt (Lambda)    │
                 └───────┬───────┘  └────┬─────┘ └──┬────────────┘
                         │                │             │
                         ▼                ▼             │
                 ┌───────────────────────────┐         │
                 │   DynamoDB (single table)    │         │
                 └───────────┬───────────────┘         │
                             │ DynamoDB Streams          │
                             ▼                            │
                 ┌───────────────────┐                   │
                 │   SQS (events queue) │                   │
                 └───────────┬───────┘                   │
                             ▼                            │
                 ┌───────────────────────┐               │
                 │  Matching Service        │               │
                 │  (EC2 t2.micro, always-on) │              │
                 │  - in-memory geo index      │              │
                 │  - naive + batch matcher     │              │
                 └───────────┬───────────┘               │
                             ▼                            │
                 ┌───────────────────┐                   │
                 │  SNS (match events)  │───────────────────┘
                 └───────────────────┘

Cross-cutting: CloudWatch (logs/metrics/alarms), Terraform (IaC), GitHub Actions (CI/CD)
```

---

## 4. Microservices Breakdown

**Design principle:** four services, each with a single, defensible reason to exist as a separate deployable unit. Every additional service you'd be tempted to add ("Auth Service," "Pricing Service," "Analytics Service") should be resisted unless it changes your scaling or deployment story — otherwise it's just organizational overhead for a solo project.

### 4.1 Location Service
- **Responsibility:** Accept driver location updates and status changes (online/offline); persist to DynamoDB; emit location-changed events.
- **Compute:** AWS Lambda (stateless, bursty, high-frequency writes — a textbook Lambda use case)
- **Why separate from Matching:** Different scaling shape. Location writes are high-frequency, small, stateless, embarrassingly parallel — ideal for Lambda's per-request scaling. Matching needs a warm, stateful in-memory index. Conflating them would force you to either run Matching on Lambda (bad — no warm state) or run Location Service on EC2 (wasteful — you'd pay for idle capacity between bursts).

### 4.2 Matching Service
- **Responsibility:** Maintain in-memory geospatial index; run naive and batch-optimal matching algorithms; atomically assign drivers to trips.
- **Compute:** EC2 t2.micro, long-running process
- **Why EC2, not Lambda:** This service needs (a) a warm in-memory index refreshed continuously, not rebuilt per-invocation, and (b) a controllable batching window (collect requests for 2-3 seconds before solving the assignment problem) — both are awkward-to-impossible with Lambda's execution model. This is the single most important "why not just use X for everything" decision in the whole project — know it cold for interviews.

### 4.3 Trip Service
- **Responsibility:** Own the trip state machine; validate state transitions; persist trip history; expose trip status APIs.
- **Compute:** Lambda
- **Why separate from Matching:** Matching is a computation ("who should be assigned"); Trip Service is a state authority ("is this transition valid, and what's the current state of truth"). Keeping the state machine in one place prevents split-brain bugs where two services disagree on trip status.

### 4.4 Notification Service
- **Responsibility:** Fan out trip/match status changes to connected rider/driver WebSocket clients.
- **Compute:** Lambda + API Gateway WebSocket API + SNS
- **Why separate:** Notification delivery is a distinct concern with different failure modes (a rider's WebSocket connection dropping shouldn't affect trip state correctness). Decoupling via SNS means Trip Service doesn't need to know anything about WebSocket connection management.

---

## 5. Service-to-Service Communication

| From | To | Mechanism | Why |
|---|---|---|---|
| Simulators | Location/Trip Service | REST via API Gateway | Simple request/response, no need for anything fancier |
| Location Service | Matching Service | DynamoDB Streams → SQS | Decouples ingestion rate from matching processing rate; buffers bursts |
| Trip Service | Matching Service | SQS (ride request queue) | Matching Service pulls at its own pace, enabling the batching window |
| Matching Service | Trip Service | Direct API call (Lambda invoke or REST) | Assignment result needs synchronous confirmation to avoid race conditions — this is a deliberate exception to "always async," and you should be able to explain why |
| Matching Service | Notification Service | SNS | Fire-and-forget fan-out; notification failure shouldn't block matching |
| Notification Service | Clients | WebSocket (API Gateway) | Real-time push without polling |

**Key trade-off to articulate in interviews:** almost everything is async/event-driven *except* the final driver-assignment write, which is synchronous with a conditional write for correctness. This shows you understand that "everything should be async" is a myth — correctness-critical paths sometimes need synchronous confirmation, and the skill is knowing which paths those are.

---

## 6. Database Design (DynamoDB Single-Table)

```
Table: RideDispatchTable
Partition Key: PK   Sort Key: SK

┌─────────────────────┬───────────────┬────────────────────────────────────────┐
│ PK                    │ SK              │ Attributes                                │
├─────────────────────┼───────────────┼────────────────────────────────────────┤
│ DRIVER#<id>            │ PROFILE          │ name, vehicle_type, rating, created_at      │
│ DRIVER#<id>            │ LOCATION          │ lat, lng, geohash, status, updated_at,       │
│                         │                    │ version (for optimistic locking)              │
│ RIDER#<id>             │ PROFILE          │ name, created_at                             │
│ TRIP#<tripId>          │ METADATA          │ rider_id, driver_id, status, pickup_lat/lng,  │
│                         │                    │ dropoff_lat/lng, requested_at, matched_at,     │
│                         │                    │ completed_at, strategy_used                    │
└─────────────────────┴───────────────┴────────────────────────────────────────┘

GSI1 — GeoIndex:      PK = GEOHASH#<prefix5>   SK = DRIVER#<id>
  → "find available drivers near this geohash prefix"

GSI2 — RiderTrips:    PK = RIDER#<riderId>     SK = TRIP#<requested_at>
  → "trip history for a rider, sorted by time"

GSI3 — DriverTrips:   PK = DRIVER#<driverId>   SK = TRIP#<requested_at>
  → "trip history for a driver"
```

**Why single-table design, and why it's defensible here:** Single-table design trades query flexibility for query *speed and cost predictability* — exactly right for a system with known, fixed access patterns (find nearby drivers, get trip by id, get trip history by rider/driver). If your access patterns were open-ended (ad-hoc analytics queries), single-table DynamoDB would be the wrong choice and a relational store would win. Say this explicitly in your design doc — it shows you're not cargo-culting a pattern.

**Geohash precision trade-off:** a 5-character geohash prefix covers roughly a 5km x 5km cell. Coarser prefixes (4 chars) = fewer partitions but noisier candidate sets (more false positives to filter); finer prefixes (6 chars) = tighter results but you must query multiple neighboring cells at boundaries. Document your chosen precision and why.

---

## 7. API Design

### Location Service
```
POST /drivers/{driverId}/location
  Body: { lat, lng, timestamp }
  → 202 Accepted (async processing)

POST /drivers/{driverId}/status
  Body: { status: "online" | "offline" }
  → 200 OK
```

### Trip Service
```
POST /riders/{riderId}/rides
  Body: { pickup: {lat,lng}, dropoff: {lat,lng} }
  → 201 Created { tripId, status: "requested" }

GET /rides/{tripId}
  → 200 OK { tripId, status, driver_id, ... }

POST /rides/{tripId}/cancel
  → 200 OK

GET /riders/{riderId}/rides?limit=20
  → 200 OK [ trip summaries ]
```

### Matching Service (internal API, not public-facing)
```
POST /internal/match
  Body: { tripId, pickup: {lat,lng} }
  → 200 OK { driverId, eta } | 404 { reason: "no_drivers_available" }
```

### Notification Service
```
WS /connect
  → establishes connection, associates connectionId with riderId/driverId

(Server-pushed, no client-invoked REST endpoints)
```

**Design note:** the Location endpoint returns `202 Accepted`, not `200 OK` — it's explicitly async (write goes to DynamoDB, event fires afterward). The Trip creation endpoint returns `201 Created` synchronously with `status: requested`, and the *match itself* happens asynchronously with the result pushed via WebSocket. Getting these HTTP semantics right is a small detail that signals real API design maturity.

---

## 8. Event Flows and Sequence Diagrams

### Flow A: Driver Location Update
```
Driver Sim → API GW → Location Lambda → DynamoDB (write LOCATION item)
                                       → DynamoDB Stream triggers
                                       → SQS (location-updated event)
                                       → Matching Service polls SQS
                                       → updates in-memory geo index
```

### Flow B: Ride Request → Match (Naive Strategy)
```
Rider Sim → API GW → Trip Lambda → DynamoDB (write TRIP, status=requested)
                                  → SQS (ride-requested event)
Matching Service polls SQS
  → query in-memory geo index for nearby available drivers
  → pick nearest by Haversine distance
  → DynamoDB conditional write: set driver status=en_route IF status=available
    (fails if another match already claimed this driver → retry with next candidate)
  → call Trip Service API: update trip status=matched, driver_id=X
  → publish SNS match-event
Notification Service (subscribed to SNS)
  → push WebSocket message to rider + driver connections
```

### Flow C: Ride Request → Match (Batch Strategy)
```
Multiple ride requests accumulate in SQS over a 2-3s window
Matching Service (on a timer tick):
  → drain up to N pending requests from queue
  → build cost matrix (rows=requests, cols=nearby available drivers, cell=ETA estimate)
  → run Hungarian algorithm → optimal assignment minimizing total cost
  → for each assignment: DynamoDB conditional write (same as Flow B)
  → batch-update Trip Service, batch-publish SNS events
```

### Sequence Diagram (Flow B, textual)
```
Rider          TripSvc         DynamoDB        SQS          MatchingSvc      NotifSvc
 |--POST /rides-->|               |             |               |               |
 |                |--write TRIP-->|             |               |               |
 |<--201 Created--|               |             |               |               |
 |                |--publish----------------->  |               |               |
 |                |               |             |--consume----->|               |
 |                |               |             |               |--query idx    |
 |                |               |<--cond write--|             |               |
 |                |<---update trip status--------|               |               |
 |                |               |             |               |--publish SNS->|
 |                |               |             |               |               |--push WS-->
```

---

## 9. Folder Structure

### Overall Repository
```
ride-dispatch-platform/
├── services/
│   ├── location-service/
│   ├── matching-service/
│   ├── trip-service/
│   └── notification-service/
├── shared/
│   ├── geospatial/          # geohash encoding, distance calc
│   ├── matching-algorithms/ # Hungarian algorithm, cost matrix builder
│   ├── models/              # shared DTOs/types
│   └── dynamo-client/       # thin wrapper around DynamoDB SDK
├── simulators/
│   ├── driver-simulator/
│   └── rider-simulator/
├── infra/
│   ├── modules/
│   │   ├── dynamodb/
│   │   ├── lambda/
│   │   ├── ec2-matching/
│   │   ├── sqs-sns/
│   │   └── api-gateway/
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
├── docs/
│   ├── architecture.md
│   ├── design-decisions.md
│   └── diagrams/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── docker-compose.yml       # local dev with LocalStack
└── README.md
```

### Per-Service Structure (example: matching-service)
```
matching-service/
├── src/
│   ├── index.ts (or main.go)
│   ├── geoIndex.ts        # in-memory quadtree/geohash index
│   ├── matcher/
│   │   ├── naiveMatcher.ts
│   │   └── batchMatcher.ts
│   ├── hungarianAlgorithm.ts
│   ├── sqsConsumer.ts
│   ├── dynamoClient.ts
│   └── config.ts
├── tests/
├── Dockerfile
└── package.json
```

---

## 10. AWS Architecture (Free Tier Only)

| Component | Service | Free Tier Coverage |
|---|---|---|
| Compute (event-driven) | Lambda | 1M requests + 400K GB-sec/month — always free |
| Compute (long-running) | EC2 t2.micro | 750 hrs/month — 12 months |
| Database | DynamoDB | 25GB + 25 WCU/RCU — always free |
| Event queue | SQS | 1M requests/month — always free |
| Pub/sub | SNS | 1M publishes/month — always free |
| API layer | API Gateway (REST + WS) | 1M REST calls + 1M WS messages/month — 12 months |
| Monitoring | CloudWatch | 10 custom metrics, 5GB logs — always free (basic tier) |
| IaC state | S3 (small bucket for Terraform state) | 5GB — 12 months |

**Explicitly avoided:** ElastiCache (no free tier), MSK/Kafka (no free tier), NAT Gateway (not free — use public subnets + tight security groups instead), ALB/NLB (not free — use API Gateway directly).

**Cost discipline:** set a $1 AWS Budget alarm on day one. Stop (don't terminate) the EC2 instance between work sessions — stopped time doesn't count against the 750-hour allotment.

---

## 11. Infrastructure Setup

### Local Development (Docker Compose + LocalStack)
```yaml
# docker-compose.yml (conceptual)
services:
  localstack:
    image: localstack/localstack
    environment:
      - SERVICES=dynamodb,sqs,sns,lambda
    ports:
      - "4566:4566"
  matching-service:
    build: ./services/matching-service
    environment:
      - AWS_ENDPOINT=http://localstack:4566
    depends_on:
      - localstack
```
Develop and unit/integration-test entirely against LocalStack. Only deploy to real AWS for milestone demos and final testing — this both saves free-tier hours and keeps your dev loop fast (no network latency to real AWS).

### Infrastructure as Code (Terraform)
- One module per AWS resource type (`dynamodb`, `lambda`, `ec2-matching`, `sqs-sns`, `api-gateway`)
- `terraform plan` before every apply; commit `.tf` files, never commit `.tfstate` (use `.gitignore` + remote S3 backend for state)
- `make down` target that runs `terraform destroy -target=module.ec2_matching` to tear down the expensive-if-forgotten resource after each session

**Why Terraform over CDK/CloudFormation:** Terraform is cloud-agnostic and the most widely used IaC tool in industry outside pure-AWS shops — better resume signal, and the HCL syntax is arguably easier to review for a solo project than CDK's imperative code-as-config approach. Worth noting CDK as an alternative you considered.

---

## 12. Security Design

Kept deliberately lightweight — this is not the core learning objective of the project, but you still need to show you *thought about it*, not ignored it.

- **Authentication:** simple bearer token scheme (issue a signed JWT per simulated rider/driver at "login," validate on API Gateway using a Lambda authorizer). This is enough to demonstrate the pattern without building a full auth service.
- **Authorization:** riders can only access their own trips (check `riderId` in JWT claims against resource); drivers can only update their own location.
- **Secrets management:** AWS Systems Manager Parameter Store (free tier) for any API keys/config — never hardcode secrets, never commit `.env` files (`.gitignore` from day one).
- **Transport security:** HTTPS enforced by API Gateway by default; WebSocket over WSS.
- **IAM:** least-privilege roles per Lambda function (each Lambda gets only the DynamoDB/SQS/SNS permissions it actually needs — don't use a wildcard `*` policy, and explain why in your design doc; this is a real interview differentiator).

**Optional stretch:** swap the JWT stub for AWS Cognito if you have time — but don't let this eat into algorithm/architecture time, since it's the least differentiating part of the project.

---

## 13. Design Patterns and Architectural Decisions

| Decision | Alternative Considered | Why This Choice |
|---|---|---|
| Single-table DynamoDB design | Multiple tables / RDS+PostGIS | Fixed access patterns, free-tier friendly, forces deliberate key design |
| EC2 for Matching Service | Lambda for everything | Need warm in-memory state + controllable batching window |
| SQS over Kafka | Self-hosted Kafka on EC2 | No ordering/partitioning requirements at this scale; SQS is free and zero-ops |
| Conditional writes over distributed locks | Redis SETNX-based locking | No Redis free tier; DynamoDB conditional writes are a native, well-understood equivalent |
| Custom geohash index over managed geo service | Redis GEO / PostGIS | No free tier for either; building it yourself is a stronger skill demonstration |
| Self-implemented Hungarian algorithm | scipy/library import | The algorithm *is* the point of the project — importing it defeats the purpose |
| Event-driven (mostly async) with one sync path | Fully synchronous request/response everywhere | Async improves throughput/decoupling; the one sync path (final assignment) is where correctness trumps decoupling |
| Terraform | Manual console setup / CDK | Reproducibility, teardown discipline, stronger generic IaC resume signal |

**Patterns used (name them explicitly in your docs):**
- **Strategy pattern** — pluggable matching algorithms (naive vs. batch) behind a common interface
- **State machine** — trip lifecycle with explicit valid-transition rules
- **Event-driven architecture / pub-sub** — SQS/SNS decoupling
- **Optimistic concurrency control** — DynamoDB conditional writes with version attributes
- **CQRS-lite** — writes go through Trip/Location services; reads for matching go through a denormalized in-memory index (not full CQRS with separate read stores, but the same underlying idea)

---

## 14. Error Handling, Retries, Idempotency, Fault Tolerance

- **Idempotency keys:** every ride request and location update carries a client-generated idempotency key (or use natural keys + conditional writes) so retried requests (e.g., a flaky simulator retry) don't create duplicate trips or corrupt state.
- **SQS retry + DLQ:** configure a redrive policy — after N failed processing attempts, messages go to a Dead Letter Queue for inspection rather than looping forever or being silently dropped.
- **Conditional writes for driver assignment:** prevents the double-booking race condition — if two match attempts try to claim the same driver, the second conditional write fails and that matcher falls back to the next candidate.
- **Timeout + reassignment:** if a driver doesn't confirm/accept a match within N seconds (simulate an "accept" step), the trip reverts to `requested` and re-enters the matching queue.
- **Circuit breaker (optional/stretch):** if Trip Service calls from Matching Service start failing repeatedly, back off and queue results instead of blocking the batch loop.
- **Graceful degradation:** if the batch matcher's cost-matrix computation exceeds a time budget (e.g., too many pending requests), fall back to naive matching for that cycle rather than blocking indefinitely — document this trade-off explicitly, it's a great interview story about balancing optimality vs. availability.

---

## 15. Logging, Monitoring, Observability

- **Structured logging:** every service logs JSON with correlation fields (`tripId`, `driverId`, `requestId`) so a single ride's journey can be traced across services in CloudWatch Logs Insights.
- **Key custom metrics (stay within the 10 free-tier metrics):**
  1. Match latency (naive)
  2. Match latency (batch)
  3. Match success rate
  4. Active driver count
  5. Pending ride requests (queue depth)
  6. Double-booking conflict rate (conditional write failures)
  7. Driver idle time (fairness proxy)
- **CloudWatch Dashboard:** one dashboard combining the above, screenshot it for your README/demo.
- **Alarms:** one alarm on queue depth (if it grows unbounded, matching is falling behind) — configure an SNS email alert.

---

## 16. Testing Strategy

| Level | What's Tested | Tooling |
|---|---|---|
| Unit | Geohash encode/decode, Haversine distance, Hungarian algorithm correctness, state machine transition rules | Jest/pytest/Go testing — run with zero AWS dependency |
| Integration | Lambda handlers against LocalStack DynamoDB/SQS | LocalStack + GitHub Actions |
| End-to-end | Full flow: simulate driver + rider, request ride, assert match occurs and trip completes | Script against a real deployed (or LocalStack) environment |
| Load | 100+ concurrent simulated drivers + burst ride requests, measure latency degradation | k6 or Locust, run manually against real AWS (not in CI, to protect free-tier limits) |

**Correctness test worth highlighting:** a concurrency test that fires many simultaneous ride requests near the same small pool of drivers and asserts zero double-bookings — this is the single test result most worth screenshotting for your README, since it directly demonstrates you solved a real distributed systems problem.

---

## 17. CI/CD Pipeline (GitHub Actions)

```
ci.yml (on every push/PR):
  1. Lint + type-check
  2. Run unit tests
  3. Spin up LocalStack in CI runner
  4. Run integration tests against LocalStack
  5. Terraform fmt + validate (no apply)

deploy.yml (manual trigger or on merge to main):
  1. Terraform plan (posted as PR comment for review)
  2. Terraform apply (manual approval gate)
  3. Deploy Lambda packages (zip + upload)
  4. Smoke test against deployed endpoints
```

**Why a manual approval gate on deploy, not full auto-deploy:** for a free-tier project, you want a human checkpoint before anything touches real AWS billing — this is also a legitimate real-world pattern for cost-sensitive or high-risk deployments, not just a student workaround.

---

## 18. Deployment Strategy

- **Environments:** just two — `local` (LocalStack) and `aws-dev` (your single real deployment; skip a separate "staging"/"prod" split, unjustified at this scale).
- **Lambda deploys:** zip-based deploy via Terraform (`aws_lambda_function` resource pointing at an S3-uploaded zip), triggered by CI.
- **EC2 Matching Service deploy:** simplest viable approach — SSH + systemd service restart via a GitHub Actions step, or a user-data script that pulls latest code from a release tag on instance boot. (Full CodeDeploy is available free-tier but adds complexity not worth it here — note it as a "what I'd add at scale.")
- **Rollback:** keep the previous Lambda version as an alias target; for EC2, keep the previous release artifact so you can redeploy it on failure.

---

## 19. Step-by-Step Implementation Roadmap

1. **Foundations:** repo scaffolding, Terraform skeleton (empty modules), Docker Compose + LocalStack, CI pipeline running (even with no tests yet)
2. **Data layer:** DynamoDB schema + GSIs, deployed via Terraform to LocalStack first, then real AWS
3. **Shared libraries:** geohash encode/decode + Haversine distance, fully unit tested
4. **Location Service:** Lambda + API Gateway endpoint, writes to DynamoDB, unit + integration tested
5. **Driver Simulator:** local script publishing fake locations to Location Service
6. **Trip Service:** Lambda + state machine, ride request/status APIs
7. **Matching Service v1 (naive):** EC2 process, in-memory geo index built from DynamoDB scan + refreshed via SQS, nearest-neighbor matching, conditional write assignment
8. **End-to-end naive flow working:** request a ride → get matched → complete trip, verified manually
9. **Notification Service:** WebSocket API Gateway + SNS subscription, push match/status events
10. **Matching Service v2 (batch):** Hungarian algorithm implementation, cost matrix builder, batching window, A/B metrics logging against naive
11. **Observability:** CloudWatch metrics, dashboard, one alarm
12. **Fault tolerance hardening:** DLQs, timeout/reassignment logic, idempotency audit
13. **Load testing:** k6 script, capture before/after metrics, tune batch window size
14. **Documentation + demo:** architecture docs, design-decisions ADRs, demo video, README polish

---

## 20. Project Milestones and Timeline (5 Months)

| Weeks | Milestone |
|---|---|
| 1–3 | Foundations + data layer + shared libs (steps 1–3) |
| 4–7 | Location Service + Trip Service + naive Matching Service working end-to-end (steps 4–8) |
| 8–10 | Notification Service + WebSocket live updates (step 9) |
| 11–15 | Batch matching algorithm + A/B comparison metrics (step 10) — this is your longest, hardest phase; budget generously |
| 16–18 | Observability + fault tolerance hardening (steps 11–12) |
| 19–20 | Load testing + tuning (step 13) |
| 21–22 | Documentation, demo video, final polish (step 14) |
| 23–22 (buffer) | ~1 week slack for AWS/Terraform surprises — always happens, budget for it |

---

## 21. Suggested GitHub Repository Structure

*(See Section 9 for the full tree.)* Additional repo hygiene:
- `CONTRIBUTING.md` not needed (solo project), but keep a `CHANGELOG.md` — great interview artifact showing iterative development
- Commit convention: Conventional Commits (`feat:`, `fix:`, `docs:`) — small, signals engineering discipline
- Branch protection on `main`, PRs even to yourself (forces the CI gate to run) — another small but real signal

---

## 22. README Structure and Documentation Checklist

```markdown
# Ride Dispatch & Matching Platform

## Overview (2-3 sentences, what it does)
## Architecture Diagram (image)
## Key Design Decisions (link to docs/design-decisions.md)
## Tech Stack
## Local Setup (Docker Compose / LocalStack instructions)
## AWS Deployment (Terraform instructions)
## API Documentation (link or inline)
## Matching Algorithm Comparison (naive vs. batch — with real numbers/graph)
## Testing (how to run each test suite)
## Observability (dashboard screenshot)
## Cost Report ("ran within AWS Free Tier, total cost: $X")
## Demo (link to video)
## Future Enhancements
```

Checklist before calling it "done":
- [ ] Architecture diagram is current, not stale
- [ ] Every major decision in Section 13 has a corresponding ADR in `docs/design-decisions.md`
- [ ] At least one quantified result (latency numbers, throughput, or the naive-vs-batch comparison)
- [ ] Setup instructions actually work on a clean machine (test this yourself)
- [ ] No secrets committed anywhere in git history

---

## 23. Possible Interview Questions Based on This Project

1. "Walk me through what happens when a ride is requested, end to end."
2. "Why did you choose DynamoDB over a relational database with PostGIS?"
3. "How do you prevent two ride requests from being matched to the same driver simultaneously?"
4. "Why is your Matching Service on EC2 instead of Lambda, given everything else is serverless?"
5. "Explain the trade-off between your naive and batch matching strategies — when would you use each?"
6. "How does the Hungarian algorithm work, and what's its time complexity? How would that affect your batch window size as request volume grows?"
7. "What happens if the Matching Service crashes mid-batch? How do you avoid losing or double-processing ride requests?"
8. "How would you scale this system to 100x the load? What would break first?"
9. "Why SQS instead of Kafka? What would change if you needed Kafka's guarantees?"
10. "How do you test a system this distributed without spinning up real AWS infrastructure for every test run?"
11. "What's your idempotency strategy, and where specifically did you need it?"
12. "If you had another 3 months, what would you build next and why?"

Prepare concrete, specific answers to all of these — not generalities. Interviewers will ask at least 3-4 of them if this project is on your resume.

---

## 24. Future Enhancements (Post-MVP)

- **Ride pooling:** match multiple riders with overlapping routes to a single driver (vehicle routing problem — meaningfully harder, good for a "v2" story)
- **Surge pricing:** demand/supply ratio per zone, recalculated periodically
- **Real routing integration:** swap straight-line ETA approximation for OSRM (open-source routing engine)
- **Multi-zone horizontal sharding:** partition the matching engine by geographic zone across multiple EC2 instances (only worth it once single-instance load testing shows a real bottleneck — don't do this preemptively)
- **Driver acceptance/rejection flow:** simulate drivers declining matches, requiring reassignment logic
- **Cognito-based real authentication**
- **Replace EC2 with ECS Fargate** for the Matching Service once off free tier, as a "here's how I'd run this in a real production setting" talking point

---

*End of blueprint. Treat this as a living document — update `docs/design-decisions.md` as you make real trade-offs during implementation, since the actual decisions you wrestle with while building are more valuable in an interview than the ones planned in advance.*
