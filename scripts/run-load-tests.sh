#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Load Testing Suite Orchestration Script (Module 28)
# ==============================================================================
# Runs the three k6 load test scripts in sequence and verifies concurrency
# correctness:
#   1. k6-location-updates.js      (Sustained driver GPS telemetry)
#   2. k6-ride-request-burst.js    (Concurrent ride request burst & matching)
#   3. k6-concurrency-correctness.js (Extreme driver contention)
#      Followed immediately by:
#      node tests/load/verify-no-double-bookings.js
#
# Usage:
#   scripts/run-load-tests.sh [BASE_URL] [AUTH_URL]
#
# Environment variables:
#   BASE_URL      - API Gateway Base URL (default: http://localhost:4566)
#   AUTH_URL      - Auth Service Base URL (default: http://localhost:4567)
#   RESULTS_DIR   - Directory where test outputs are saved (default: tests/load/results)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BASE_URL="${1:-${BASE_URL:-http://localhost:4566}}"
AUTH_URL="${2:-${AUTH_URL:-http://localhost:4567}}"
RESULTS_DIR="${RESULTS_DIR:-$ROOT_DIR/tests/load/results}"

mkdir -p "$RESULTS_DIR"

echo "========================================================"
echo "    RIDE DISPATCH PLATFORM - LOAD TESTING SUITE (k6)"
echo "========================================================"
echo "Target Base URL: $BASE_URL"
echo "Target Auth URL: $AUTH_URL"
echo "Results Dir:     $RESULTS_DIR"
echo "Date:            $(date)"
echo "========================================================"

# Locate k6 executable (support PATH or standard Windows install location)
K6_CMD="k6"
if ! command -v k6 >/dev/null 2>&1; then
  if [ -f "/c/Program Files/k6/k6.exe" ]; then
    K6_CMD="/c/Program Files/k6/k6.exe"
  elif [ -f "C:\\Program Files\\k6\\k6.exe" ]; then
    K6_CMD="C:\\Program Files\\k6\\k6.exe"
  else
    echo "ERROR: k6 executable not found in PATH or 'C:\\Program Files\\k6\\k6.exe'."
    echo "Please install k6 (see tests/load/README.md) before running load tests."
    exit 1
  fi
fi

echo "Using k6 binary: $($K6_CMD version)"
echo ""

# ------------------------------------------------------------------------------
# Test 1: Sustained Location Updates
# ------------------------------------------------------------------------------
echo "========================================================"
echo "Test 1/3: Sustained Driver Location Updates"
echo "========================================================"
LOC_OUT="$RESULTS_DIR/location-updates-summary.txt"

"$K6_CMD" run \
  -e BASE_URL="$BASE_URL" \
  -e AUTH_URL="$AUTH_URL" \
  -e DRIVER_COUNT="${DRIVER_COUNT:-20}" \
  -e DURATION="${DURATION:-30s}" \
  "$ROOT_DIR/tests/load/k6-location-updates.js" | tee "$LOC_OUT"

echo "Completed Test 1. Summary written to $LOC_OUT"
echo ""

# ------------------------------------------------------------------------------
# Test 2: Ride Request Burst
# ------------------------------------------------------------------------------
echo "========================================================"
echo "Test 2/3: Ride Request Burst & Time-to-Match"
echo "========================================================"
BURST_OUT="$RESULTS_DIR/ride-burst-summary.txt"

"$K6_CMD" run \
  -e BASE_URL="$BASE_URL" \
  -e AUTH_URL="$AUTH_URL" \
  -e DRIVER_SETUP_COUNT="${DRIVER_SETUP_COUNT:-10}" \
  -e BURST_COUNT="${BURST_COUNT:-15}" \
  "$ROOT_DIR/tests/load/k6-ride-request-burst.js" | tee "$BURST_OUT"

echo "Completed Test 2. Summary written to $BURST_OUT"
echo ""

# ------------------------------------------------------------------------------
# Test 3: Concurrency Correctness (Contention Stress Test)
# ------------------------------------------------------------------------------
echo "========================================================"
echo "Test 3/3: Concurrency Correctness (Contention Stress Test)"
echo "========================================================"
CONCURRENCY_OUT="$RESULTS_DIR/concurrency-output.log"

"$K6_CMD" run \
  -e BASE_URL="$BASE_URL" \
  -e AUTH_URL="$AUTH_URL" \
  -e DRIVER_COUNT="${CONCURRENCY_DRIVERS:-3}" \
  -e REQUEST_COUNT="${CONCURRENCY_REQUESTS:-10}" \
  "$ROOT_DIR/tests/load/k6-concurrency-correctness.js" | tee "$CONCURRENCY_OUT"

echo ""
echo "========================================================"
echo "Validating Zero Double-Bookings"
echo "========================================================"

# Allow 5 seconds for in-flight matches to settle in DynamoDB
sleep 5

BASE_URL="$BASE_URL" AUTH_URL="$AUTH_URL" node "$ROOT_DIR/tests/load/verify-no-double-bookings.js" "$CONCURRENCY_OUT"

echo ""
echo "========================================================"
echo "LOAD TESTING SUITE COMPLETED SUCCESSFULLY!"
echo "All test summaries and logs are preserved in: $RESULTS_DIR"
echo "========================================================"
