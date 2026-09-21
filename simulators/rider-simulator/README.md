# Rider Simulator (`@ride-dispatch/rider-simulator`)

The Rider Simulator is a Node.js / TypeScript CLI tool that simulates multiple riders requesting rides and polling for status transitions against the deployed **Trip Service** via HTTP REST APIs.

The simulator has **zero AWS SDK dependencies** — it acts purely as a real-world mobile client communicating via HTTP with:

1. **Auth Stub** (`POST /auth/token`) to obtain signed JWT credentials with `role: "rider"`.
2. **Trip Service API Gateway**:
   - `POST /riders/{id}/rides` to request new rides with randomized pickup and dropoff coordinates in the operational area.
   - `GET /rides/{id}` to poll ride status transitions until terminal state (`COMPLETED` or `CANCELLED`) or max polling attempts are exhausted.

---

> [!IMPORTANT]
> **Build Sequence Context (Modules 17–18 Note)**:  
> At this point in the build sequence (before Modules 17–18's **Matching Service** exists), rides created by this simulator will remain in `REQUESTED` state and the poller will report `"still PENDING"` after its max attempts — **this is expected, not a bug**. Re-run this simulator once Matching Service is deployed to see rides actually progress to `MATCHED` and beyond.

---

## 1. Architectural Overview & Request Model

- **Self-Contained Model & Independent Math**: The `Point` interface and uniform disc sampling math ($r = R \sqrt{U}$, planar equirectangular distance approximation) are maintained directly within the package to ensure simulator autonomy and zero workspace dependency overhead.
- **Degenerate Trip Prevention**: If randomly generated pickup and dropoff points fall within ~200 meters of each other, the dropoff is regenerated to guarantee realistic urban trip requests.
- **Exponential Backoff Polling**: Status polling starts at 500ms and doubles on each attempt (`500ms`, `1000ms`, `2000ms`, `4000ms`), capped at `5000ms`.
- **Bounded Polling Lifecycle**: Polling terminates upon reaching a terminal state (`COMPLETED` or `CANCELLED`), or logs an informative `still PENDING (expected until Matching Service exists)` message when `MAX_POLL_ATTEMPTS` is reached.
- **Client-Side Token Caching**: Each rider maintains an in-memory `TokenCache` that decodes JWT `exp` claims without verifying cryptographic signatures client-side, refreshing credentials 30 seconds prior to expiration.
- **Jittered Cycle Interval**: After finishing with one ride, riders pause for a random jittered duration between `MIN_REQUEST_INTERVAL_MS` and `MAX_REQUEST_INTERVAL_MS` before requesting another.

---

## 2. Environment Variables

| Variable                  | Required | Default     | Description                                                                                                                           |
| ------------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TRIP_SERVICE_BASE_URL`   | **Yes**  | _None_      | Base URL for Trip Service API Gateway endpoints (e.g., `http://localhost:4566/restapis/<api_id>/local/_user_request_`).              |
| `AUTH_SERVICE_BASE_URL`   | **Yes**  | _None_      | Base URL for Auth Stub API Gateway endpoints (exposing `POST /auth/token`).                                                           |
| `RIDER_COUNT`             | No       | `3`         | Number of concurrent riders to simulate (`sim-rider-1`, `sim-rider-2`, `sim-rider-3`).                                               |
| `AREA_CENTER_LAT`         | No       | `37.7749`   | Latitude of simulation area center (San Francisco). Accepts `CITY_CENTER_LAT` as fallback.                                             |
| `AREA_CENTER_LNG`         | No       | `-122.4194` | Longitude of simulation area center (San Francisco). Accepts `CITY_CENTER_LNG` as fallback.                                            |
| `AREA_RADIUS_METERS`      | No       | `3000`      | Operational radius in meters around the center point.                                                                                 |
| `MIN_REQUEST_INTERVAL_MS` | No       | `5000`      | Minimum interval between ride request cycles per rider in ms.                                                                         |
| `MAX_REQUEST_INTERVAL_MS` | No       | `10000`     | Maximum interval between ride request cycles per rider in ms.                                                                         |
| `MAX_POLL_ATTEMPTS`       | No       | `15`        | Maximum status polling attempts before concluding the polling phase for a ride.                                                       |

### Obtaining Endpoint URLs from Terraform (Module 13)

After provisioning infrastructure with Terraform against LocalStack, query the unified API Gateway invoke URL:

```bash
cd infra
export API_URL=$(terraform output -raw api_gateway_invoke_url)
# Example: http://localhost:4566/restapis/abc123def4/local/_user_request_
```

Then export the required variables:

```bash
export TRIP_SERVICE_BASE_URL="$API_URL"
export AUTH_SERVICE_BASE_URL="$API_URL"
```

---

## 3. Running the Simulator

### From the Monorepo Root

```bash
# Run directly via tsx without manual compilation:
npm run start --workspace=@ride-dispatch/rider-simulator

# Or with inline environment variables:
TRIP_SERVICE_BASE_URL="http://localhost:4566/restapis/abc123def4/local/_user_request_" \
AUTH_SERVICE_BASE_URL="http://localhost:4566/restapis/abc123def4/local/_user_request_" \
RIDER_COUNT=3 \
npm run start --workspace=@ride-dispatch/rider-simulator
```

### Stopping the Simulator

Press **`Ctrl+C`** (`SIGINT`) or send `SIGTERM`. The CLI catches the interruption, signals all rider loops via an `AbortSignal`, waits up to 5 seconds for in-flight HTTP requests and backoff timers to cleanly resolve, and exits:

```
^C
Received SIGINT. Initiating graceful shutdown...
[sim-rider-1] Rider loop gracefully exited.
[sim-rider-2] Rider loop gracefully exited.
[sim-rider-3] Rider loop gracefully exited.
All riders stopped. Simulator exited cleanly.
```

---

## 4. Example Console Output

```
================================================================
       RIDE DISPATCH PLATFORM - RIDER SIMULATOR (CLI)
================================================================
Riders Count:        3
Area Center:         (37.7749, -122.4194)
Area Radius:         3000 meters
Request Interval:    5000ms - 10000ms
Max Poll Attempts:   15
Trip Base URL:       http://localhost:4566/restapis/9f61b0fa/local/_user_request_
Auth Base URL:       http://localhost:4566/restapis/9f61b0fa/local/_user_request_
----------------------------------------------------------------
NOTE: Until Matching Service (Modules 17-18) is deployed, rides
will remain in REQUESTED state. Polling will log "still PENDING".
----------------------------------------------------------------
Press Ctrl+C to stop simulation gracefully.

[sim-rider-1] Ride requested: 7d4981a2-58ce-472d-8b01-a189f7238210 | Pickup: (37.7712, -122.4153) -> Dropoff: (37.7845, -122.4089)
[sim-rider-2] Ride requested: b2948cf1-901c-4b5a-a309-847291a8e100 | Pickup: (37.7689, -122.4091) -> Dropoff: (37.7801, -122.4289)
[sim-rider-3] Ride requested: c8301824-34ef-4b92-8012-d81726a91102 | Pickup: (37.7758, -122.4210) -> Dropoff: (37.7821, -122.4172)
[sim-rider-1] Ride 7d4981a2-58ce-472d-8b01-a189f7238210 still PENDING after 15 attempts (expected until Matching Service exists). Last state: REQUESTED
[sim-rider-1] Waiting 7340ms before requesting next ride...
```

---

## 5. Development & Testing

```bash
# Run unit and property tests:
npm test --workspace=@ride-dispatch/rider-simulator

# Run linter:
npm run lint --workspace=@ride-dispatch/rider-simulator

# Compile TypeScript to dist/:
npm run build --workspace=@ride-dispatch/rider-simulator
```
