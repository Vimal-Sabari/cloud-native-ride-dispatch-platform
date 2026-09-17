# Architecture Decision Records (ADRs)

## ADR: Polyglot Architecture — Go for Location/Matching, TypeScript for Trip/Notification

**Decision:** Location Service and Matching Service (plus their shared libraries: geospatial, matching-algorithms) are implemented in Go. Trip Service and Notification Service are implemented in TypeScript.

**Why:** Location Service handles high-frequency, small, bursty writes and Matching Service is a long-running EC2 process maintaining a warm in-memory geo index and running a batching loop — both benefit from Go's low memory footprint, fast Lambda cold starts, and native goroutine-based concurrency for the matching loop's internal work. Trip Service and Notification Service are I/O-orchestration and state-machine-shaped services where TypeScript's fast iteration speed, rich AWS SDK v3 ergonomics, and lower boilerplate for REST/WebSocket handler code are the better fit.

**Cost of this choice:** two toolchains to maintain; DTOs shared between the Go and TypeScript halves (e.g., the Trip DTO that both Trip Service (TS) and Matching Service (Go) need to understand) must be kept in sync manually across shared/models/go and shared/models/ts, since there is no shared runtime to enforce this automatically. This is an explicit, accepted trade-off — mitigated by treating shared/models as a single conceptual source of truth with parallel implementations, and by keeping the DTOs intentionally small and stable.
