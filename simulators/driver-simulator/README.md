# Driver Simulator (`@ride-dispatch/driver-simulator`)

The Driver Simulator is a Node.js / TypeScript CLI tool that simulates multiple drivers concurrently moving through an urban area and continuously updating their location and status against the deployed **Location Service** via HTTP REST APIs.

The simulator has **zero AWS SDK dependencies** — it acts purely as a real-world mobile client communicating via HTTP with:

1. **Auth Stub** (`POST /auth/token`) to obtain signed JWT credentials with `role: "driver"`.
2. **Location Service API Gateway** (`POST /drivers/{id}/location` and `POST /drivers/{id}/status`) to update geospatial coordinates and driver availability.

---

## 1. Architectural Overview & Movement Model

- **Bounded Random Walk**: Drivers begin at a uniformly distributed position within `AREA_RADIUS_METERS` of the city center. On each step, drivers move by a step vector (~30 meters). If a candidate step exceeds the operational radius, the driver steps directly back toward the center (reflection boundary).
- **Equirectangular Approximation**: Movement uses an intentionally lightweight flat-Earth equirectangular projection ($R = 6,371,000\text{m}$) tailored for rapid local simulation, rather than the heavy geodesic math required by production backend indexing.
- **Client-Side Token Caching**: Each driver maintains an in-memory `TokenCache` that decodes the JWT's `exp` claim without verifying cryptographic signatures client-side, automatically refreshing credentials 30 seconds prior to expiration.
- **Status Transitions**: Periodically, drivers toggle availability between `"available"` and `"busy"` to simulate ride lifecycle states.

---

## 2. Environment Variables

| Variable                    | Required | Default     | Description                                                                                                                 |
| --------------------------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `LOCATION_SERVICE_BASE_URL` | **Yes**  | _None_      | Base URL for Location Service API Gateway endpoints (e.g., `http://localhost:4566/restapis/<api_id>/local/_user_request_`). |
| `AUTH_SERVICE_BASE_URL`     | **Yes**  | _None_      | Base URL for Auth Stub API Gateway endpoints (exposing `POST /auth/token`).                                                 |
| `DRIVER_COUNT`              | No       | `5`         | Number of concurrent drivers to simulate (`sim-driver-1`, `sim-driver-2`, ...).                                             |
| `CITY_CENTER_LAT`           | No       | `37.7749`   | Latitude of simulation area center (San Francisco).                                                                         |
| `CITY_CENTER_LNG`           | No       | `-122.4194` | Longitude of simulation area center (San Francisco).                                                                        |
| `AREA_RADIUS_METERS`        | No       | `3000`      | Operational radius in meters around the center point.                                                                       |
| `MIN_UPDATE_INTERVAL_MS`    | No       | `1000`      | Minimum interval between location updates per driver (ms).                                                                  |
| `MAX_UPDATE_INTERVAL_MS`    | No       | `2000`      | Maximum interval between location updates per driver (ms).                                                                  |

### Obtaining Endpoint URLs from Terraform (Module 10)

After provisioning infrastructure with Terraform against LocalStack, query the API Gateway invoke URL:

```bash
cd infra
export API_URL=$(terraform output -raw api_gateway_invoke_url)
# Example: http://localhost:4566/restapis/abc123def4/local/_user_request_
```

Then export the required variables:

```bash
export LOCATION_SERVICE_BASE_URL="$API_URL"
export AUTH_SERVICE_BASE_URL="$API_URL"
```

---

## 3. Running the Simulator

### From the Monorepo Root

```bash
# Run directly via tsx without precompilation:
npm run start --workspace=@ride-dispatch/driver-simulator

# Or with inline environment variables:
LOCATION_SERVICE_BASE_URL="http://localhost:4566/restapis/abc123def4/local/_user_request_" \
AUTH_SERVICE_BASE_URL="http://localhost:4566/restapis/abc123def4/local/_user_request_" \
DRIVER_COUNT=5 \
npm run start --workspace=@ride-dispatch/driver-simulator
```

### Stopping the Simulator

Press **`Ctrl+C`** (`SIGINT`) or send `SIGTERM`. The CLI catches the interruption, signals all driver loops via an `AbortSignal`, waits up to 5 seconds for in-flight HTTP requests to complete, and exits cleanly:

```
^C
Received SIGINT. Initiating graceful shutdown...
[sim-driver-1] Driver loop gracefully exited.
[sim-driver-2] Driver loop gracefully exited.
[sim-driver-3] Driver loop gracefully exited.
[sim-driver-4] Driver loop gracefully exited.
[sim-driver-5] Driver loop gracefully exited.
All drivers stopped. Simulator exited cleanly.
```

---

## 4. Example Console Output

```
================================================================
       RIDE DISPATCH PLATFORM - DRIVER SIMULATOR (CLI)
================================================================
Drivers Count:       5
City Center:         (37.7749, -122.4194)
Area Radius:         3000 meters
Update Interval:     1000ms - 2000ms
Location Base URL:   http://localhost:4566/restapis/9f61b0fa/local/_user_request_
Auth Base URL:       http://localhost:4566/restapis/9f61b0fa/local/_user_request_
----------------------------------------------------------------
Press Ctrl+C to stop simulation gracefully.
----------------------------------------------------------------

[sim-driver-1] Location: (37.77120, -122.41530) | HTTP 200 OK | Status Update: available (200 OK) | Next: 1420ms
[sim-driver-3] Location: (37.78014, -122.42890) | HTTP 200 OK | Status Update: available (200 OK) | Next: 1150ms
[sim-driver-2] Location: (37.76891, -122.40912) | HTTP 200 OK | Status Update: available (200 OK) | Next: 1890ms
[sim-driver-4] Location: (37.77583, -122.42104) | HTTP 200 OK | Status Update: available (200 OK) | Next: 1610ms
[sim-driver-5] Location: (37.78210, -122.41720) | HTTP 200 OK | Status Update: available (200 OK) | Next: 1330ms
[sim-driver-1] Location: (37.77145, -122.41512) | HTTP 200 OK | Next: 1240ms
[sim-driver-3] Location: (37.78038, -122.42875) | HTTP 200 OK | Next: 1530ms
[sim-driver-2] Location: (37.76915, -122.40898) | HTTP 200 OK | Next: 1720ms
```

---

## 5. Development & Testing

```bash
# Run unit and property tests:
npm test --workspace=@ride-dispatch/driver-simulator

# Run linter:
npm run lint --workspace=@ride-dispatch/driver-simulator

# Compile TypeScript to dist/:
npm run build --workspace=@ride-dispatch/driver-simulator
```
