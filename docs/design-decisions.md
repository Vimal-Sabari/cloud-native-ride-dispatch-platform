# Architecture Decision Records (ADRs)

## ADR: Polyglot Architecture — Go for Location/Matching, TypeScript for Trip/Notification

**Decision:** Location Service and Matching Service (plus their shared libraries: geospatial, matching-algorithms) are implemented in Go. Trip Service and Notification Service are implemented in TypeScript.

**Why:** Location Service handles high-frequency, small, bursty writes and Matching Service is a long-running EC2 process maintaining a warm in-memory geo index and running a batching loop — both benefit from Go's low memory footprint, fast Lambda cold starts, and native goroutine-based concurrency for the matching loop's internal work. Trip Service and Notification Service are I/O-orchestration and state-machine-shaped services where TypeScript's fast iteration speed, rich AWS SDK v3 ergonomics, and lower boilerplate for REST/WebSocket handler code are the better fit.

**Cost of this choice:** two toolchains to maintain; DTOs shared between the Go and TypeScript halves (e.g., the Trip DTO that both Trip Service (TS) and Matching Service (Go) need to understand) must be kept in sync manually across shared/models/go and shared/models/ts, since there is no shared runtime to enforce this automatically. This is an explicit, accepted trade-off — mitigated by treating shared/models as a single conceptual source of truth with parallel implementations, and by keeping the DTOs intentionally small and stable.

## ADR: Geohash Precision — 5 Characters

**Decision:** Geohash prefix indexing in the platform uses a standard precision of 5 characters (~4.9km × 4.9km bounding box at the equator).

**Why:**
- **Trade-off Analysis:**
  - *Coarser precision (4 characters, ~39km × 19.5km):* Results in excessively large spatial partition buckets containing hundreds of drivers, creating severe false positives and CPU overhead during candidate filtering in the Matching Service.
  - *Finer precision (6 characters, ~1.2km × 0.6km):* Cells are too small for typical urban ride dispatch radii (3–5km), requiring excessive adjacent cell lookups (querying 9+ cells per dispatch query) and generating unnecessary fan-out I/O on driver location queries.
  - *5 characters (~4.9km × 4.9km):* Offers an optimal baseline balance where a single cell plus its immediate 8 neighbors naturally covers a ~15km × 15km urban dispatch envelope with bounded candidate counts.
- **Revision Strategy:** 5 characters is chosen as the starting architectural default, subject to tuning and revision based on real-world load testing and density profiles across different metropolitan areas.

*Note on Implementation Language:* This geospatial library is implemented in Go per the polyglot architecture ADR, as it is consumed exclusively by the Go-based Location Service and Matching Service.

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
