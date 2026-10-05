# DynamoDB Write Path Idempotency & Concurrency Audit

## Executive Summary

This document provides a systematic review of every DynamoDB write path across the **Ride Dispatch Platform** microservices (Location Service, Trip Service, Matching Service, and Notification Service). It analyzes the concurrency control and idempotency mechanisms in place, documents why each design is appropriate for its domain, and confirms system-wide fault tolerance.

---

## Service-by-Service Write Path Audit

### 1. Location Service (Go)

- **Write Operations:**
  - Driver Location Telemetry: `PutItem` on `PK = "DRIVER#<driverId>"`, `SK = "LOCATION"`, updating latitude, longitude, geohash, and TTL `expiresAt`.
  - Driver Status Update: `PutItem` updating `status` (`available`, `busy`, `offline`) and secondary index key `GSI1SK = "DRIVER#<status>#<driverId>"`.
- **Protection Mechanism:**
  - **No idempotency key or conditional write** (pure Last-Write-Wins / LWW).
- **Rationale & Correctness:**
  - Driver telemetry is high-frequency sensor data emitted at 5–10 Hz per driver. For real-time geospatial tracking, fresher GPS telemetry strictly supersedes older telemetry; exact-once semantics or optimistic locking would introduce unacceptable database contention and latency without operational benefit.
  - Status updates represent state overwrites where $f(f(x)) = f(x)$. If an "offline" or "available" update is retried, the end state remains identical. Concurrency between status updates and matching claims is safely arbitrated downstream by Matching Service's conditional claim mechanism rather than in Location Service.

---

### 2. Trip Service (TypeScript)

- **Write Operations:**
  - `POST /rides` (`request-ride`):
    - **Protection:** **Idempotency Key via Reservation Pointer Item** (`PK = "IDEMPOTENCY#<riderId>#<key>"`, `SK = "DETAILS"`).
    - **Mechanism:** Uses `conditionalPutItem(pointer, "attribute_not_exists(PK)")`. If a client resubmits a request with the same idempotency key, the conditional write fails, the existing ride is retrieved, and returned with HTTP 200/201. If an idempotency race occurs between concurrent Lambda invocations, exactly one wins and the loser replays the winner's result.
  - `POST /rides/{id}/cancel` (`cancel-ride`):
    - **Protection:** **Optimistic Locking via Conditional Update**.
    - **Mechanism:** Evaluates current ride state in the state machine (`REQUESTED`, `MATCHED`, `DRIVER_EN_ROUTE`), then performs `updateRide` with `ConditionExpression: "#state = :expectedState"`. If another actor (e.g. driver accept or completed trip) changes the state concurrently, DynamoDB returns `ConditionalCheckFailedException`, which the handler translates to an HTTP 409 Conflict.
  - `POST /internal/rides/{id}/assign-driver` (`internal-assign-driver`):
    - **Protection:** **Conditional State Mutation & Active Ride Pointer**.
    - **Mechanism:** Executes `updateRide` with `ConditionExpression: "#state = :requested"` transitioning to `MATCHED`, setting `GSI4PK = "STATE#MATCHED"`, `GSI4SK = <updatedAt>`. Followed by writing `DRIVER#<driverId>#ACTIVE_RIDE_POINTER` with `GSI3PK/SK` to prevent the driver from taking subsequent active rides. If two dispatchers attempt to assign different drivers to the same ride concurrently, exactly one succeeds and the other receives HTTP 409 Conflict.
  - `reassign-stale-matches` (Scheduled Job - Module 27):
    - **Protection:** **Double Optimistic Locking Condition**.
    - **Mechanism:**
      1. Ride transition to `REQUESTED`: `ConditionExpression: "#state = :matched AND #updatedAt = :oldUpdatedAt"`. If the driver accepted the ride (`DRIVER_EN_ROUTE`) or the rider cancelled (`CANCELLED`) during execution, the write fails safely (returns `false`) and the ride is skipped without side effects.
      2. Driver release: `ConditionExpression: "#status = :busy"` resetting driver status to `available` and clearing `GSI3` active ride pointer. This prevents clobbering a driver who was already transitioned or assigned elsewhere.

---

### 3. Matching Service (Go)

- **Write Operations:**
  - Driver Claim (`claimDriver`):
    - **Protection:** **Conditional Put Item**.
    - **Mechanism:** Executes `ConditionalPutItem` with `ConditionExpression: "#status = :available"`. This is the core mutual-exclusion primitive protecting against driver double-booking across distributed matching instances. If two concurrent batches select the same candidate driver, only one claim succeeds; the second receives `ConditionalCheckFailedException` (handled gracefully as `(false, nil)`), causing that match to be skipped or deferred to a fallback candidate.
  - Driver Claim Revert (`RevertDriverClaim` - Module 17/27):
    - **Protection:** **Conditional Put Item with Expected Status Guard**.
    - **Mechanism:** When downstream dispatch assignment fails (e.g., Trip Service returns 409 Conflict or 500), the driver must be released. `RevertDriverClaim` executes `ConditionalPutItem` with `ConditionExpression: "#status = :busy"` (or `:expectedCurrentStatus`). If the driver state was already modified (e.g. driver went offline), the revert does not blindly overwrite status.

---

### 4. Notification Service (TypeScript)

- **Write Operations:**
  - `$connect` (`connect.ts`):
    - **Protection:** Unique connection ID partition key (`PK = "CONN#<connectionId>"`, `SK = "METADATA"`).
    - **Mechanism:** API Gateway WebSocket engine generates a cryptographically random, globally unique `connectionId` for every distinct TCP/TLS session. Retrying a `$connect` event for an existing connection ID overwrites identical metadata (`userId`, `role`, `connectedAt`, TTL `expiresAt`). Because `connectionId` cannot collide across distinct clients, strict conditional writes are unnecessary.
  - `$disconnect` (`disconnect.ts`):
    - **Protection:** Native DynamoDB Delete Idempotency.
    - **Mechanism:** Invokes `deleteItem(PK, SK)`. In DynamoDB, `DeleteItem` is naturally idempotent: deleting an existing item deletes it, and deleting a non-existent or previously deleted item succeeds without error.
  - Stale Connection Eviction (`sns-fanout-entry.ts`):
    - **Protection:** Native DynamoDB Delete Idempotency upon `GoneException` (HTTP 410) from API Gateway Management API. Cleans up disconnected sockets safely.

---

## Audit Findings & Verdict

1. **Double-Booking Protection:** Matching Service's conditional claim (`#status = :available`) coupled with Trip Service's conditional assignment (`#state = :requested`) and driver active pointer (`GSI3`) completely eliminates split-brain driver allocations.
2. **State Transition Integrity:** All transitions in Trip Service enforce strict finite state machine validation backed by DynamoDB `ConditionExpression`s. Uncontrolled concurrent mutations result in HTTP 409 Conflict rather than data corruption.
3. **Telemetry & Notification Throughput:** Telemetry (Location Service) and socket tracking (Notification Service) deliberately leverage idempotent overwrites and deletes rather than heavyweight CAS locks, maximizing throughput while preserving operational correctness.
4. **Stale Match Healing:** The Module 27 driver-accept timeout reassignment job uses multi-attribute condition checks (`#state = :matched AND #updatedAt = :oldUpdatedAt`) guaranteeing zero race-condition side effects if a driver accepts just as the timeout expires.

**Audit Status:** PASSED. No unprotected multi-writer corruption vectors identified.
