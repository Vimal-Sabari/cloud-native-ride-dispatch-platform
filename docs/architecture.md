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

| Attribute | Type | Example / Value | Description |
|-----------|------|-----------------|-------------|
| `PK` | S | `DRIVER#driver-123` | Driver entity partition key |
| `SK` | S | `LOCATION` | Location entity sort key |
| `GSI1PK` | S | `GEOHASH#9q8yy` | Spatial geohash partition (precision 5, ~4.9km × 4.9km) |
| `GSI1SK` | S | `DRIVER#available#driver-123` | Status-prefixed driver index for spatial candidate queries |
| `driverId` | S | `driver-123` | Driver ID |
| `status` / `Status` | S | `available` \| `busy` \| `offline` | Driver availability status |
| `lat` / `Lat` | N | `37.7749` | Latitude coordinate |
| `lng` / `Lng` | N | `-122.4194` | Longitude coordinate |
| `updatedAt` / `UpdatedAt` | S | `2026-09-18T10:00:00Z` | RFC3339 UTC timestamp |
| `expiresAt` / `ExpiresAt` | N | `1789715765` | Unix epoch timestamp (current time + 5 minutes) |

### TTL & Automatic Stale Record Reaping

- The DynamoDB table configures `expiresAt` as the Time-to-Live (TTL) attribute.
- Every location and status update computes `expiresAt = currentTime + 5 minutes` (Unix epoch seconds).
- If a driver device loses network connectivity, crashes, or terminates the driver application without explicitly toggling to `"offline"`, DynamoDB automatically evicts the stale record.
- This prevents "ghost drivers" from appearing in spatial candidate queries in the Matching Service.

### GSI1SK Consistency Pattern

Location updates carry coordinates without status, while status updates carry status without coordinates. The Location Service uses a read-then-write approach to maintain consistent `GSI1SK` attributes.

See [ADR: GSI1SK Consistency Between Location and Status Updates](design-decisions.md#adr-gsi1sk-consistency-between-location-and-status-updates) for details on the read-then-write approach and concurrency trade-offs.
