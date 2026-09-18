# DynamoDB Single-Table Data Model

This document specifies the single-table design for the **Cloud-Native Ride Dispatch & Matching Platform**.

---

## 1. Single-Table Design Rationale

Rather than provisioning separate tables for drivers, trips, riders, and dispatch states, the platform employs a **DynamoDB Single-Table Design**.

### Core Benefits:
1. **Minimized Network Latency:** Pre-joined data and related entities can be retrieved in a single `Query` call instead of multiple round-trip requests.
2. **Cost & Operational Efficiency:** Under `PAY_PER_REQUEST` billing, managing a single table with secondary indexes significantly simplifies operational overhead, monitoring, alarm thresholds, and IAM permissions.
3. **Atomic Multi-Entity Transactions:** DynamoDB transactional operations (`TransactWriteItems`) allow atomic updates across multiple entity types (e.g., creating a trip and atomically assigning an active ride pointer to a driver) without cross-table complexity.

---

## 2. Entity & Access Pattern Mapping

The table uses generic partition and sort keys:
- **Primary Key:** `PK` (Partition Key, String), `SK` (Sort Key, String)
- **GSI1:** `GSI1PK` (String), `GSI1SK` (String) — *Geohash Driver Availability*
- **GSI2:** `GSI2PK` (String), `GSI2SK` (String) — *Rider Trip History*
- **GSI3:** `GSI3PK` (String), `GSI3SK` (String) — *Driver Active Trip Guard*

| Entity Type | PK Pattern | SK Pattern | GSIs Used | Access Pattern / Description |
| :--- | :--- | :--- | :--- | :--- |
| **Driver Location** | `DRIVER#<driverId>` | `LOCATION` | **GSI1** (`GSI1PK`, `GSI1SK`) | Query latest driver location and heartbeat; query all available drivers within a geohash cell via GSI1 (`GEOHASH#<geohash>`, `DRIVER#AVAILABLE#<driverId>`). Auto-expired by `expiresAt` TTL. |
| **Trip / Ride** | `TRIP#<tripId>` | `METADATA` | **GSI2** (`GSI2PK`, `GSI2SK`) | Retrieve full trip details and state machine lifecycle (`REQUESTED`, `MATCHED`, `IN_PROGRESS`, `COMPLETED`); query all rides for a rider sorted by timestamp via GSI2 (`RIDER#<riderId>`, `RIDE#<timestamp>#<tripId>`). |
| **Driver Active Trip Pointer** | `TRIP#<tripId>` | `DRIVER_ASSIGNMENT` | **GSI3** (`GSI3PK`, `GSI3SK`) | Enforce single active ride per driver constraint. Exists only while trip is active. GSI3 (`DRIVER#<driverId>`, `ACTIVE_RIDE`) prevents concurrent trip assignment via conditional writes. Deleted upon trip completion. |

---

## 3. Worked JSON Item Examples

### 3.1 Driver Location Record (Main Table + GSI1)

Updated periodically by Location Service via driver heartbeat pings. Includes `expiresAt` TTL to automatically prune stale location reports.

```json
{
  "PK": "DRIVER#drv_98a72b14",
  "SK": "LOCATION",
  "GSI1PK": "GEOHASH#dr5re",
  "GSI1SK": "DRIVER#AVAILABLE#drv_98a72b14",
  "driverId": "drv_98a72b14",
  "status": "AVAILABLE",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "bearing": 128.5,
  "speed": 11.2,
  "geohash": "dr5re",
  "updatedAt": "2026-09-18T10:15:30Z",
  "expiresAt": 1789726590
}
```

- **Main Table Lookup:** `GetItem(PK="DRIVER#drv_98a72b14", SK="LOCATION")` -> Get real-time coordinates of driver.
- **GSI1 Query:** `Query(GSI1PK="GEOHASH#dr5re", GSI1SK begins_with "DRIVER#AVAILABLE")` -> Find all available drivers in Manhattan cell `dr5re`.

---

### 3.2 Trip / Ride Record (Main Table + GSI2)

Created by Trip Service when a rider requests a ride. Transitions through status states (`REQUESTED` -> `MATCHED` -> `IN_PROGRESS` -> `COMPLETED`).

```json
{
  "PK": "TRIP#trip_47f9c102",
  "SK": "METADATA",
  "GSI2PK": "RIDER#rdr_10293847",
  "GSI2SK": "RIDE#2026-09-18T10:14:00Z#trip_47f9c102",
  "tripId": "trip_47f9c102",
  "riderId": "rdr_10293847",
  "driverId": "drv_98a72b14",
  "status": "IN_PROGRESS",
  "pickupLat": 40.7128,
  "pickupLng": -74.0060,
  "pickupAddress": "123 Broadway, New York, NY",
  "destinationLat": 40.7589,
  "destinationLng": -73.9851,
  "destinationAddress": "Times Square, New York, NY",
  "fareAmount": 24.50,
  "currency": "USD",
  "createdAt": "2026-09-18T10:14:00Z",
  "updatedAt": "2026-09-18T10:18:22Z"
}
```

- **Main Table Lookup:** `GetItem(PK="TRIP#trip_47f9c102", SK="METADATA")` -> Retrieve current state of trip.
- **GSI2 Query:** `Query(GSI2PK="RIDER#rdr_10293847", ScanIndexForward=false)` -> Retrieve rider's trip history ordered newest to oldest.

---

### 3.3 Driver Active Trip Pointer (GSI3)

Sparse index pointer created alongside an active ride assignment. Ensures a driver cannot be assigned multiple simultaneous trips.

```json
{
  "PK": "TRIP#trip_47f9c102",
  "SK": "DRIVER_ASSIGNMENT",
  "GSI3PK": "DRIVER#drv_98a72b14",
  "GSI3SK": "ACTIVE_RIDE",
  "tripId": "trip_47f9c102",
  "driverId": "drv_98a72b14",
  "assignedAt": "2026-09-18T10:16:05Z"
}
```

- **GSI3 Query:** `Query(GSI3PK="DRIVER#drv_98a72b14", GSI3SK="ACTIVE_RIDE")` -> Returns non-empty if the driver is currently on an active ride.
- **Conditional Assignment:** During dispatch matching, a conditional transaction writes this item only if no active assignment exists for `DRIVER#drv_98a72b14`. When the trip transitions to `COMPLETED` or `CANCELLED`, this item is deleted.
