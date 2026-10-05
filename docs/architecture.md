# Architecture Documentation

This document describes the high-level architecture, services, data models, and interaction patterns of the cloud-native ride-dispatch platform.

## Location Service

The **Location Service** is responsible for receiving high-frequency driver telemetry (GPS coordinate heartbeats) and availability status transitions, keeping the real-time driver spatial index up to date in DynamoDB.

### Endpoints

1. **`POST /drivers/{id}/location`**
   - **Binary:** `cmd/update-location`
   - **Payload:** `{"lat": float64, "lng": float64}`
   - **Validation:** Enforces `lat` in `[-90, 90]` and `lng` in `[-180, 180]` via `geospatial.Encode(lat, lng, 5)`.
   - **Description:** Updates the driver's current spatial coordinates, re-encodes the geohash cell, and resets the 5-minute heartbeat TTL.

2. **`PUT /drivers/{id}/status`**
   - **Binary:** `cmd/update-status`
   - **Payload:** `{"status": string}`
   - **Validation:** Enforces `status` to be one of `"available"`, `"busy"`, or `"offline"`.
   - **Description:** Updates the driver's availability status, retaining their existing GPS location (or defaulting to `0.0, 0.0` if no prior heartbeat was received) and resetting the 5-minute heartbeat TTL.

### DynamoDB Schema & GSI1 Shape

The Location Service writes directly to the single table defined in `infra/modules/dynamodb`:

| Attribute                 | Type | Example / Value                    | Description                                                |
| ------------------------- | ---- | ---------------------------------- | ---------------------------------------------------------- |
| `PK`                      | S    | `DRIVER#driver-123`                | Driver entity partition key                                |
| `SK`                      | S    | `LOCATION`                         | Location entity sort key                                   |
| `GSI1PK`                  | S    | `GEOHASH#9q8yy`                    | Spatial geohash partition (precision 5, ~4.9km × 4.9km)    |
| `GSI1SK`                  | S    | `DRIVER#available#driver-123`      | Status-prefixed driver index for spatial candidate queries |
| `driverId`                | S    | `driver-123`                       | Driver ID                                                  |
| `status` / `Status`       | S    | `available` \| `busy` \| `offline` | Driver availability status                                 |
| `lat` / `Lat`             | N    | `37.7749`                          | Latitude coordinate                                        |
| `lng` / `Lng`             | N    | `-122.4194`                        | Longitude coordinate                                       |
| `updatedAt` / `UpdatedAt` | S    | `2026-09-18T10:00:00Z`             | RFC3339 UTC timestamp                                      |
| `expiresAt` / `ExpiresAt` | N    | `1789715765`                       | Unix epoch timestamp (current time + 5 minutes)            |

### TTL & Automatic Stale Record Reaping

- The DynamoDB table configures `expiresAt` as the Time-to-Live (TTL) attribute.
- Every location and status update computes `expiresAt = currentTime + 5 minutes` (Unix epoch seconds).
- If a driver device loses network connectivity, crashes, or terminates the driver application without explicitly toggling to `"offline"`, DynamoDB automatically evicts the stale record.
- This prevents "ghost drivers" from appearing in spatial candidate queries in the Matching Service.

### GSI1SK Consistency Pattern

Location updates carry coordinates without status, while status updates carry status without coordinates. The Location Service uses a read-then-write approach to maintain consistent `GSI1SK` attributes.

See [ADR: GSI1SK Consistency Between Location and Status Updates](design-decisions.md#adr-gsi1sk-consistency-between-location-and-status-updates) for details on the read-then-write approach and concurrency trade-offs.

---

## Trip Service

The **Trip Service** orchestrates the ride lifecycle, managing ride requests, cancellations, driver assignment callbacks, and trip history queries. Implemented in TypeScript (`services/trip-service/`), it executes framework-free Lambda handlers backed by a narrow `DynamoAccessor` abstraction.

### Endpoints

#### Rider-Facing Endpoints (Protected by JWT Authorizer)

1. **`POST /rides`** (`requestRide`)
   - **Payload:** `{"pickup": {"lat": number, "lng": number}, "dropoff": {"lat": number, "lng": number}, "idempotencyKey"?: string}`
   - **Status Codes:** `201 Created` (new ride), `200 OK` (idempotent replay), `400 Bad Request` (invalid coordinates or missing rider ID).
   - **Description:** Validates spatial coordinates, checks idempotency pointer (`IDEMPOTENCY#<riderId>#<key>`), initializes ride in `REQUESTED` state, writes main item (`RIDE#<rideId>` / `DETAILS`) and GSI2 index, and conditionally writes the idempotency pointer to resolve concurrent races.

2. **`GET /rides/{id}`** (`getRide`)
   - **Status Codes:** `200 OK` (ride object returned), `404 Not Found` (ride ID does not exist), `400 Bad Request` (empty ride ID).
   - **Description:** Retrieves the ride item by primary key (`PK = RIDE#<rideId>`, `SK = DETAILS`).

3. **`POST /rides/{id}/cancel`** (`cancelRide`)
   - **Status Codes:** `200 OK` (cancelled ride object), `404 Not Found`, `409 Conflict` (state precondition failed or concurrent write race), `400 Bad Request`.
   - **Description:** Checks whether the ride's current state permits cancellation (`REQUESTED`, `MATCHED`, or `DRIVER_EN_ROUTE`). Uses optimistic locking via conditional put (`state = <currentState>`) to transition state to `CANCELLED`. Returns HTTP 409 if in an active/terminal state (`IN_PROGRESS`, `COMPLETED`, `CANCELLED`).

4. **`GET /riders/{id}/rides`** (`listRiderRides`)
   - **Status Codes:** `200 OK` (array of ride objects), `400 Bad Request`.
   - **Description:** Queries GSI2 (`GSI2PK = RIDER#<riderId>`) and returns all historical rides requested by the rider, sorted most-recent-first by `GSI2SK` descending.

#### Internal System Endpoints (Protected by Shared Secret API Key)

5. **`POST /internal/rides/{id}/assign-driver`** (`assignDriver` / `internalAssignDriver`)
   - **Header:** `x-internal-api-key` (verified against `process.env.INTERNAL_API_KEY`).
   - **Status Codes:** `200 OK` (matched ride object), `401 Unauthorized` (missing/invalid key), `404 Not Found`, `409 Conflict` (state transition not allowed or race condition), `400 Bad Request`.
   - **Description:** Invoked by the Go Matching Service daemon when a candidate driver is matched to a ride. Verifies the internal API key, asserts the ride is in `REQUESTED` state, conditionally updates the ride to `MATCHED` with `driverId`, and writes the driver's active ride pointer in GSI3.

---

### State Machine

The ride lifecycle is governed by an explicit finite state machine with strict transition guards:

```
                  ┌──────────────────────┐
                  │      REQUESTED       │
                  └──────────┬───────────┘
                             │
                  ┌──────────┴───────────┐
                  ▼                      ▼
           ┌──────────────┐       ┌─────────────┐
           │   MATCHED    │       │  CANCELLED  │ (Terminal)
           └──────┬───────┘       └─────────────┘
                  │                      ▲
                  ├──────────────────────┤
                  ▼                      │
         ┌──────────────────┐            │
         │ DRIVER_EN_ROUTE  │            │
         └────────┬─────────┘            │
                  │                      │
                  ├──────────────────────┘
                  ▼
         ┌──────────────────┐
         │   IN_PROGRESS    │
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │    COMPLETED     │ (Terminal)
         └──────────────────┘
```

- **Allowed Transitions:**
  - `REQUESTED` $\rightarrow$ `MATCHED`, `CANCELLED`
  - `MATCHED` $\rightarrow$ `DRIVER_EN_ROUTE`, `CANCELLED`
  - `DRIVER_EN_ROUTE` $\rightarrow$ `IN_PROGRESS`, `CANCELLED`
  - `IN_PROGRESS` $\rightarrow$ `COMPLETED`
  - `COMPLETED` $\rightarrow$ `[]` (terminal state; immutable)
  - `CANCELLED` $\rightarrow$ `[]` (terminal state; immutable)

---

### Global Secondary Indexes: GSI2 & GSI3 Roles

1. **GSI2 (Rider Trip History)**:
   - **Partition Key (`GSI2PK`):** `RIDER#<riderId>`
   - **Sort Key (`GSI2SK`):** `RIDE#<createdAt>#<rideId>`
   - **Role:** Indexes all ride items by rider ID. Because `GSI2SK` embeds the ISO-8601 creation timestamp directly after the prefix, querying GSI2 with `ScanIndexForward = false` retrieves a rider's trip history in descending chronological order without secondary sorting.

2. **GSI3 (Driver Active Ride Pointer & Concurrency Guard)**:
   - **Partition Key (`GSI3PK`):** `DRIVER#<driverId>`
   - **Sort Key (`GSI3SK`):** `ACTIVE_RIDE`
   - **Role:** A sparse index item (`PK: DRIVER#<id>`, `SK: ACTIVE_RIDE_POINTER`) written when a driver is assigned to a ride. Allows the matching engine and notification service to immediately look up a driver's active trip and enforce that a driver can only be assigned to one active ride at a time.

---

## Event Forwarding (DynamoDB Streams to SQS)

The **Event Forwarder** (`services/event-forwarder/`) is a lightweight Go Lambda function listening to the single-table DynamoDB Stream (`NEW_AND_OLD_IMAGES`) and forwarding domain events asynchronously to SQS queues for downstream consumption by the Matching Service.

### Architectural Role

- **Decoupled Ingestion:** Prevents synchronous coupling between database writes (Location Service and Trip Service) and message queue publishing, ensuring API responses are fast and immune to downstream queue availability issues.
- **Ordered Event Ingestion:** Leverages DynamoDB Stream's guaranteed write ordering per shard to capture real-time state changes without distributed transactions.
- **Selective Batch Error Handling:** Utilizes `ReportBatchItemFailures` so transient SQS failures only retry the affected record, preventing head-of-line blocking on the DynamoDB stream shard.

### Classification and Routing Rules

| Entity / Condition | Stream Event | Destination Queue | Event Type | Payload Schema |
|---|---|---|---|---|
| `SK == "LOCATION"` | `INSERT` \| `MODIFY` | `location-events` | `location-updated` | `{"driverId": string, "geohash": string, "status": string, "lat": number, "lng": number}` |
| `PK` begins with `RIDE#` & `SK == "DETAILS"` & `NewImage.state == "REQUESTED"` | `INSERT` | `ride-request-events` | `ride-requested` | `{"rideId": string, "riderId": string, "pickup": {"lat": number, "lng": number}}` |
| `PK` begins with `RIDE#` & `SK == "DETAILS"` & `NewImage.state == "CANCELLED"` & `OldImage.state in ["REQUESTED", "MATCHED"]` | `MODIFY` | `ride-request-events` | `ride-cancelled` | `{"rideId": string}` |
| Any other record (e.g. `GSI3` pointer, `REMOVE`, intermediate states) | Any | *Ignored* (not forwarded) | *N/A* | *N/A* |

---

## Matching Service

The **Matching Service** (`services/matching-service/`) is a continuous daemon written in Go that pairs incoming ride requests with nearby available drivers. It consumes asynchronous domain events from SQS queues (`location-events` and `ride-request-events`), maintains an in-memory spatial index, evaluates nearest-driver heuristics, and confirms matches via a two-phase claim-then-confirm protocol against DynamoDB and Trip Service.

### In-Memory Index & Persistence Note

> [!IMPORTANT]
> **In-memory index has no persistence across restarts:** The spatial `GeoIndex` is maintained purely in memory as a map of geohash cells and driver entries for $O(1)$ low-latency candidate queries. When the Matching Service process restarts (e.g., during deployments, crashes, or autoscaling), the in-memory index starts empty. It rapidly repopulates as drivers emit periodic heartbeat telemetry via Location Service (which forwards to `location-events` SQS). For immediate post-restart warm-up or cold-start scenarios, a snapshot hydration mechanism is planned for subsequent iterations.

### Core Processing Loops

1. **Location Events Loop:**
   - Long-polls `location-events` SQS queue (`WaitTimeSeconds = 20`).
   - Receives `location-updated` events emitted by the DynamoDB Streams forwarder.
   - Upserts driver coordinate and status (`available`, `busy`, `offline`) in `GeoIndex`.
   - On processing error, leaves message on queue for redrive to DLQ.
   - Deletes successfully processed messages.

2. **Ride Request Events Loop:**
   - Long-polls `ride-request-events` SQS queue (`WaitTimeSeconds = 20`).
   - For `ride-requested` events:
     - Queries `GeoIndex` for available drivers in the pickup's geohash and its 8 neighbor cells.
     - Ranks candidate drivers using Haversine distance (`NaiveNearestMatcher`, top 3 candidates).
     - Executes two-phase claim-then-confirm assignment:
       - Conditionally claims candidate in DynamoDB (`#status = :available` $\rightarrow$ `"busy"`).
       - Confirms match with Trip Service (`POST /internal/rides/{id}/assign-driver`).
       - If Trip Service call fails, executes compensating revert (`#status = :busy` $\rightarrow$ `"available"`).
   - For `ride-cancelled` events:
     - Acknowledges event; Trip Service state machine prevents cancelled rides from being assigned.
   - Deletes successfully processed messages.

---

## Observability

The platform implements consistent, structured, correlation-ID-carrying logging and CloudWatch Embedded Metric Format (EMF) custom metric emission across all microservices.

### Logging Architecture & Packages

- **Go Services (`shared/logging/go`):** Powered by `github.com/rs/zerolog`. Emits newline-delimited JSON to `os.Stdout` with a base `service` field. Supports `WithCorrelationID(id string)` to derive child loggers bound with `correlationId`. Provides `EmitEMFMetric(...)` to output standard CloudWatch EMF payloads.
- **TypeScript Services (`shared/logging/ts`):** Powered by `pino`. Emits newline-delimited JSON to `process.stdout` with a base `service` field. Supports `withCorrelationId(id: string)` via pino child loggers bound with `correlationId`. Provides `emitEMFMetric(...)` adhering to the exact EMF format.

### Correlation ID Field Conventions

All log lines consistently use the camelCase field name `"correlationId"`. The value bound to `correlationId` depends on the microservice domain context:

| Service / Ingestion Path | Context / Handler | Correlation ID Source |
|---|---|---|
| **Location Service** | `HandleUpdateLocation`, `HandleUpdateStatus` | `driverId` |
| **Trip Service** | `requestRide`, `getRide`, `cancelRide`, `internalAssignDriver` | `rideId` (with fallback to `riderId` or request ID prior to ride generation) |
| **Matching Service** | `location-events` worker path (`processLocationMessage`) | `driverId` |
| **Matching Service** | `ride-request-events` worker path (`processRideRequestMessage`, `Assigner.Assign`) | `rideId` |
| **Auth Stub** | Token issuance & Lambda authorizer | Generated request ID (`requestId` from API Gateway context or UUID) |
| **Notification Service** | WebSocket `$connect`, `$disconnect`, connection management | Generated request ID or connection-scoped identifier |

### CloudWatch EMF Custom Metrics

EMF records are emitted directly to stdout as valid CloudWatch EMF JSON objects. CloudWatch Logs automatically extracts these into custom CloudWatch metrics with zero additional network requests or infrastructure overhead.

#### Metric Inventory

| Namespace | Dimensions | Metric Name | Unit | Description |
|---|---|---|---|---|
| `RideDispatch/LocationService` | `[Route]` | `RequestCount` | `Count` | Total successful driver location updates |
| `RideDispatch/LocationService` | `[Route]` | `ErrorCount` | `Count` | Total failed driver location updates |
| `RideDispatch/TripService` | `[Route]` | `RequestCount` | `Count` | Total successful ride requests |
| `RideDispatch/TripService` | `[Route]` | `ErrorCount` | `Count` | Total failed ride requests |
| `RideDispatch/MatchingService` | `[Strategy]` | `MatchAttempted` | `Count` | Total dispatch matching attempts initiated (emitted per request) |
| `RideDispatch/MatchingService` | `[Strategy]` | `MatchSucceeded` | `Count` | Total ride match attempts resulting in driver assignment |
| `RideDispatch/MatchingService` | `[Strategy]` | `MatchFailed` | `Count` | Total ride match attempts where no driver was assigned |
| `RideDispatch/MatchingService` | `[Strategy]` | `MatchDecisionDurationMs` | `Milliseconds` | Execution latency of the matching heuristic and assignment pipeline |

### Migration Scope and Verification Note

> [!NOTE]
> **Representative Handler Verification:**
> Module 25 deliberately focused deep verification and automated test coverage on three representative handlers across the platform:
> 1. **Location Service:** Location update handler (`services/location-service/internal/handler/location.go`)
> 2. **Trip Service:** Request ride handler (`services/trip-service/src/handlers/request-ride.ts`)
> 3. **Matching Service:** Assignment flow and dispatch loops (`services/matching-service/internal/assignment/assignment.go`, `internal/matcher/naive.go`, `internal/matcher/batch.go`, and `cmd/matching-service/main.go`)
> 
> All existing behavioral test suites for these three handlers were executed and confirmed to pass with zero regressions. Applying the identical structured logging and EMF emission pattern to the remaining platform handlers (e.g., driver status updates, ride cancellations, WebSocket connection managers, event forwarder) is a documented, mechanical, lower-risk follow-up rather than claimed to be exhaustively executed in this single module.
