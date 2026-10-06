# Load Testing Suite (k6)

This directory contains the automated performance and concurrency stress-testing suite for the Ride Dispatch Platform using [k6](https://k6.io/).

## Overview

The load test suite covers three distinct operational scenarios:
1. **`k6-location-updates.js` (Sustained Driver Telemetry):** Evaluates throughput and latency of high-frequency GPS heartbeats to Location Service (`POST /drivers/{id}/location`).
2. **`k6-ride-request-burst.js` (Spike / Burst Ingestion):** Stresses the end-to-end matching loop by dispatching a burst of concurrent ride requests (`POST /riders/{id}/rides`) against a pre-seeded driver pool, recording match success rate and time-to-match latency percentiles.
3. **`k6-concurrency-correctness.js` (Contention Stress & Race Conditions):** Forces extreme candidate overlap in a dense 200m zone where ride requests substantially exceed available drivers ($N \gg M$). Validates that the **claim-then-confirm pattern (Module 17)** and **Hungarian batch matcher (Module 23)** guarantee **zero double-bookings**.
4. **`verify-no-double-bookings.js`:** A post-run Node.js verification tool that inspects all rides created during `k6-concurrency-correctness.js`, queries Trip Service, and mathematically proves that no driver was simultaneously assigned to overlapping active trips.

---

## Installing k6

k6 is distributed as a standalone precompiled binary rather than an npm package.

### Windows
Using Windows Package Manager (Winget):
```powershell
winget install k6 --accept-source-agreements --accept-package-agreements
```
Or with Chocolatey:
```powershell
choco install k6
```

### macOS
Using Homebrew:
```bash
brew install k6
```

### Linux (Debian / Ubuntu)
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

Verify installation:
```bash
k6 version
```

---

## Running the Tests Locally (against LocalStack)

### Prerequisites
1. LocalStack running and infrastructure provisioned via Terraform (`infra/`).
2. Mock Auth Server running (`node tests/integration/mock-auth-server.js` on port `4567`).
3. Matching Service daemon running in the background.

*(Or run `tests/integration/e2e-naive-flow-test.sh` to initialize the stack automatically).*

### 1. Run the Full Suite Orchestrator
```bash
bash scripts/run-load-tests.sh http://localhost:4566 http://localhost:4567
```

### 2. Run Individual Tests

#### Test 1: Sustained Location Updates
```bash
k6 run \
  -e BASE_URL=http://localhost:4566 \
  -e AUTH_URL=http://localhost:4567 \
  -e DRIVER_COUNT=100 \
  -e DURATION=2m \
  tests/load/k6-location-updates.js
```

#### Test 2: Ride Request Burst
```bash
k6 run \
  -e BASE_URL=http://localhost:4566 \
  -e AUTH_URL=http://localhost:4567 \
  -e DRIVER_SETUP_COUNT=20 \
  -e BURST_COUNT=50 \
  tests/load/k6-ride-request-burst.js
```

#### Test 3: Concurrency Correctness (Contention Test)
```bash
# Run test and capture tagged output
k6 run \
  -e BASE_URL=http://localhost:4566 \
  -e AUTH_URL=http://localhost:4567 \
  -e DRIVER_COUNT=5 \
  -e REQUEST_COUNT=20 \
  tests/load/k6-concurrency-correctness.js | tee results/concurrency.log

# Verify zero double-bookings
BASE_URL=http://localhost:4566 AUTH_URL=http://localhost:4567 node tests/load/verify-no-double-bookings.js results/concurrency.log
```

---

## Running against Real AWS (Module 29 Deployment)

When validating against real AWS infrastructure deployed via Terraform:
```bash
# Retrieve output URLs from infra/
cd infra
export API_URL=$(terraform output -raw api_gateway_invoke_url)
export AUTH_URL="$API_URL" # In production, points to Auth API endpoint or Cognito
cd ..

# Run load tests against cloud environment
bash scripts/run-load-tests.sh "$API_URL" "$AUTH_URL"
```
