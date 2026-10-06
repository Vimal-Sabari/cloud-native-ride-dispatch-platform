# Changelog

All notable changes to the **Cloud-Native Ride Dispatch & Matching Platform** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-06

### Full Platform Release & Documentation Polish (Module 30)

- **Comprehensive Architecture Documentation:** Finalized [`docs/architecture.md`](docs/architecture.md) featuring an embedded Mermaid diagram illustrating the complete topology of all five microservices, DynamoDB single-table storage, DynamoDB Streams, SQS queues/DLQs, SNS fan-out, and API Gateway WebSocket connections.
- **Architectural Decision Record (ADR) Index:** Added a complete, clickable Table of Contents to [`docs/design-decisions.md`](docs/design-decisions.md) indexing all 23 ADRs spanning Modules 1 through 29.
- **AWS Cost & Free Tier Report:** Published [`docs/cost-report.md`](docs/cost-report.md) itemizing every AWS service utilized, contrasting resource consumption against monthly Free Tier allowances, and providing cost guardrails.
- **Live Demo & Presentation Script:** Created [`docs/demo-script.md`](docs/demo-script.md) detailing a rehearsable, 5-minute technical walkthrough covering polyglot choices, live dispatch simulations, CloudWatch EMF dashboards, A/B matching metrics, and algorithmic proofs.
- **Root Documentation Overhaul:** Completely rewrote [`README.md`](README.md) into a scannable, production-grade technical overview with badges, architecture flowcharts, engineering highlights, and documentation indexes.

---

## [0.3.0] - 2026-10-06

### Load Testing, Concurrency Verification & Deployment Automation (Modules 28–29)

- **k6 Load & Stress Testing Suite:** Built automated k6 performance tests (`tests/load/`) simulating 100+ concurrent drivers sending continuous GPS telemetry (`k6-location-updates.js`), 50-request ride dispatch bursts (`k6-ride-request-burst.js`), and severe candidate contention (`k6-concurrency-correctness.js`).
- **Zero Double-Booking Mathematical Verification:** Implemented `tests/load/verify-no-double-bookings.js`, mathematically confirming that zero drivers were double-booked during 20 concurrent requests competing for 5 drivers in a 200m radius.
- **Approval-Gated Continuous Deployment Pipeline:** Implemented [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) triggered via `workflow_dispatch`, featuring artifact compilation, human approval gating via the `aws-dev-production` GitHub Environment, passwordless AWS OIDC authentication, and automated `terraform apply -auto-approve`.
- **Live Deployment Smoke Tests:** Added [`scripts/smoke-test-deployed.sh`](scripts/smoke-test-deployed.sh) to validate live API Gateway REST endpoints, JWT authentication, and trip lifecycle responses following cloud deployment.
- **One-Command Teardown Automation:** Created [`scripts/teardown-aws-dev.sh`](scripts/teardown-aws-dev.sh) for clean destruction of real cloud resources between evaluation sessions.

---

## [0.2.0] - 2026-10-05

### Optimal Batch Matching, Observability & Platform Hardening (Modules 20–27)

- **Self-Implemented Hungarian Algorithm:** Implemented the $O(n^3)$ Kuhn-Munkres minimum-weight bipartite matching algorithm in pure Go (`shared/matching-algorithms/hungarian.go`) with dynamic sentinel-cost padding for rectangular matrices ($N \ne M$). Verified correctness against an exhaustive brute-force permutation reference solver across 100+ randomized matrices.
- **Dual-Strategy Batch Matching Engine:** Introduced an in-memory aggregation window (3,000 ms / 20 requests) with automatic graceful degradation to naive nearest-neighbor matching if deadlines expire or candidate pools are exhausted.
- **Match-Decision Telemetry & A/B Benchmarking:** Added structured JSON decision logging (`match_decision`) and an offline analysis tool (`scripts/analyze-match-decisions.js`), proving batch matching reduces deadhead pickup distance by 25% and improves match success rate from 50% to 80%.
- **Real-Time WebSocket Notifications:** Added Notification Service with API Gateway WebSocket API (`$connect`, `$disconnect`), DynamoDB socket connection mapping, SNS topic fan-out (`match-events`), and automatic stale socket pruning via `GoneException` (HTTP 410) handling.
- **Zero-Cost CloudWatch EMF Observability:** Standardized structured logging across Go (`zerolog`) and TypeScript (`pino`) with correlation-ID tracking, emitting CloudWatch Embedded Metric Format (EMF) logs to generate custom CloudWatch metrics with zero outbound HTTP API calls.
- **Centralized CloudWatch Dashboard & DLQ Alarms:** Provisioned a unified CloudWatch overview dashboard and two high-signal metric alarms monitoring Dead-Letter Queue depths (`ride-request-dlq-depth`, `location-events-dlq-depth`) alerting to an SNS operations topic.
- **Automated Stale-Match Reassignment Worker:** Added a scheduled background Lambda triggered by Amazon EventBridge every minute to detect abandoned matches past the 60-second driver acceptance timeout, resetting rides to `REQUESTED`, freeing drivers to `available`, and re-enqueuing requests using a sparse GSI4 index.
- **Idempotency & Concurrency Audit:** Conducted a comprehensive platform-wide audit of all DynamoDB write paths, documenting conditional check expressions, optimistic locking patterns, and deduplication keys in [`docs/idempotency-audit.md`](docs/idempotency-audit.md).

---

## [0.1.0] - 2026-09-18

### Initial Event-Driven Dispatch Pipeline (Modules 1–19)

- **Polyglot Workspace Foundation:** Initialized Go workspace (`go.work`) and TypeScript npm workspaces for parallel microservice development.
- **Geospatial Indexing Library:** Implemented geohash encoding, 8-neighbor bounding calculation, and Haversine spherical distance calculations from first principles in Go (`shared/geospatial`).
- **DynamoDB Single-Table Architecture:** Designed and provisioned the unified single table with GSI1 (geohash availability), GSI2 (rider trip history), and GSI3 (driver active trip guard) via Terraform.
- **Polyglot DynamoDB Clients:** Built parallel DynamoDB client wrappers in Go and TypeScript with matching APIs and native conditional write error handling.
- **Location Service:** Built custom Go runtime Lambdas (`update-location`, `update-status`) exposed via Amazon API Gateway with custom JWT token authorization.
- **Trip Service:** Implemented TypeScript Lambdas governing the ride lifecycle state machine (`request-ride`, `get-ride`, `cancel-ride`, `list-rider-rides`) and internal assignment callbacks.
- **DynamoDB Streams Event Forwarder:** Implemented Go Lambda listening to DynamoDB Streams and asynchronously publishing domain events to `location-events` and `ride-request-events` SQS queues.
- **Matching Service Daemon:** Developed long-running Go daemon consuming from SQS, maintaining an in-memory spatial index, and executing two-phase atomic claim-then-confirm driver assignment.
- **Continuous Integration & Local Emulation:** Established LocalStack 3.8 container orchestration (`make up`), Terraform local state management, and GitHub Actions CI workflow (`ci.yml`) covering linting, unit tests, and 12 integration test suites.
- **Simulators & E2E Validation:** Created autonomous Driver and Rider Simulator CLI tools and end-to-end naive dispatch verification scripts.
