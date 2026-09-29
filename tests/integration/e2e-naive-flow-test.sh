#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# End-to-End Naive Matching Pipeline Verification (Module 19)
# ==============================================================================
# Executes Driver Simulator and Rider Simulator simultaneously against the full
# naive matching platform infrastructure (Modules 1 through 18) and asserts that
# the aggregate match success rate meets or exceeds MIN_MATCH_SUCCESS_RATE.
#
# Configurable Parameters (via Environment Variables):
#   DRIVER_COUNT           - Number of simulated drivers (default: 10)
#   RIDER_COUNT            - Number of simulated riders (default: 5)
#   RUN_DURATION_SECONDS   - Active traffic duration in seconds (default: 150)
#   MIN_MATCH_SUCCESS_RATE - Required match success ratio 0.0 - 1.0 (default: 0.5)
#   ENDPOINT_URL           - LocalStack endpoint (default: http://localhost:4566)
#   TEARDOWN               - Teardown Terraform on exit (default: false)
# ==============================================================================

DRIVER_COUNT="${DRIVER_COUNT:-10}"
RIDER_COUNT="${RIDER_COUNT:-5}"
RUN_DURATION_SECONDS="${RUN_DURATION_SECONDS:-150}"
MIN_MATCH_SUCCESS_RATE="${MIN_MATCH_SUCCESS_RATE:-0.5}"

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
TABLE_NAME="${TABLE_NAME:-ride-dispatch-platform-local}"
JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-for-ride-dispatch-local-testing}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-dev-internal-api-key-for-matching-service}"
AUTH_PORT="${AUTH_PORT:-4567}"
TEARDOWN="${TEARDOWN:-false}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Generate a run-specific prefix so repeated executions never collide with past state
RUN_PREFIX="run_$(date +%s)_$RANDOM"

MATCHING_PID=""
AUTH_PID=""
DRIVER_SIM_PID=""
RIDER_SIM_PID=""

MATCHING_LOG="$ROOT_DIR/matching-service-e2e.log"
DRIVER_LOG="$ROOT_DIR/driver-simulator.log"
RIDER_LOG="$ROOT_DIR/rider-simulator.log"

cleanup_process() {
  local pid="$1"
  local name="$2"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      if command -v taskkill >/dev/null 2>&1; then
        taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
      else
        pkill -P "$pid" 2>/dev/null || true
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  fi
}

cleanup() {
  echo ""
  echo "=== Cleaning Up Background Processes ==="
  cleanup_process "$DRIVER_SIM_PID" "Driver Simulator"
  cleanup_process "$RIDER_SIM_PID" "Rider Simulator"
  cleanup_process "$MATCHING_PID" "Matching Service"
  cleanup_process "$AUTH_PID" "Mock Auth Server"

  if [ "$TEARDOWN" = "true" ]; then
    echo "Tearing down Terraform infrastructure..."
    cd "$ROOT_DIR/infra"
    terraform destroy -input=false -var-file=local.tfvars -auto-approve || true
    if [ -f "backend.tf.bak" ]; then
      mv backend.tf.bak backend.tf
    fi
    cd "$ROOT_DIR"
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------------------------
# Step 1: Validating LocalStack & Infrastructure
# ------------------------------------------------------------------------------
echo "=================================================================="
echo "      RIDE DISPATCH PLATFORM - END-TO-END PIPELINE VERIFICATION"
echo "=================================================================="
echo "Run Prefix:              $RUN_PREFIX"
echo "Driver Count:            $DRIVER_COUNT"
echo "Rider Count:             $RIDER_COUNT"
echo "Duration:                ${RUN_DURATION_SECONDS}s"
echo "Target Match Rate:       $MIN_MATCH_SUCCESS_RATE (>= $(echo "$MIN_MATCH_SUCCESS_RATE * 100" | bc -l 2>/dev/null || echo "50")%)"
echo "LocalStack Endpoint:     $ENDPOINT_URL"
echo "=================================================================="

echo ""
echo "=== Step 1: Validating Infrastructure & LocalStack ==="
bash "$ROOT_DIR/scripts/wait-for-localstack.sh"

echo "Ensuring Lambda zip artifacts are present..."
if [ ! -f "$ROOT_DIR/services/auth-stub/authorizer.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/auth-stub" src/authorizer.ts authorizer
fi
if [ ! -f "$ROOT_DIR/services/location-service/update-location.zip" ]; then
  bash "$ROOT_DIR/scripts/build-go-lambda.sh" "$ROOT_DIR/services/location-service" update-location
fi
if [ ! -f "$ROOT_DIR/services/location-service/update-status.zip" ]; then
  bash "$ROOT_DIR/scripts/build-go-lambda.sh" "$ROOT_DIR/services/location-service" update-status
fi
if [ ! -f "$ROOT_DIR/services/trip-service/request-ride.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/trip-service" src/handlers/request-ride-entry.ts request-ride
fi
if [ ! -f "$ROOT_DIR/services/trip-service/get-ride.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/trip-service" src/handlers/get-ride-entry.ts get-ride
fi
if [ ! -f "$ROOT_DIR/services/trip-service/cancel-ride.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/trip-service" src/handlers/cancel-ride-entry.ts cancel-ride
fi
if [ ! -f "$ROOT_DIR/services/trip-service/list-rider-rides.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/trip-service" src/handlers/list-rider-rides-entry.ts list-rider-rides
fi
if [ ! -f "$ROOT_DIR/services/trip-service/assign-driver.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/trip-service" src/handlers/internal-assign-driver-entry.ts assign-driver
fi
if [ ! -f "$ROOT_DIR/services/event-forwarder/event-forwarder.zip" ]; then
  bash "$ROOT_DIR/scripts/build-go-lambda.sh" "$ROOT_DIR/services/event-forwarder" event-forwarder
fi

cd "$ROOT_DIR/infra"
if ! terraform output api_gateway_invoke_url >/dev/null 2>&1; then
  echo "Applying Terraform infrastructure against LocalStack..."
  if [ -f "backend.tf" ]; then
    mv backend.tf backend.tf.bak
  fi
  terraform init
  terraform plan -input=false -var-file=local.tfvars -out=tfplan
  terraform apply -input=false tfplan
fi

INVOKE_URL=$(terraform output -raw api_gateway_invoke_url)
INVOKE_URL="${INVOKE_URL%/}"
TABLE_NAME=$(terraform output -raw dynamodb_table_name 2>/dev/null || echo "$TABLE_NAME")
LOC_QUEUE_URL=$(terraform output -raw location_events_queue_url)
RIDE_QUEUE_URL=$(terraform output -raw ride_request_events_queue_url)

echo "Infrastructure ready."
echo "API Gateway:             $INVOKE_URL"
echo "DynamoDB Table:          $TABLE_NAME"
echo "Location Queue URL:      $LOC_QUEUE_URL"
echo "Ride Request Queue URL:  $RIDE_QUEUE_URL"
cd "$ROOT_DIR"

# Purge any stale messages from prior runs
aws sqs purge-queue --endpoint-url "$ENDPOINT_URL" --queue-url "$LOC_QUEUE_URL" 2>/dev/null || true
aws sqs purge-queue --endpoint-url "$ENDPOINT_URL" --queue-url "$RIDE_QUEUE_URL" 2>/dev/null || true

# ------------------------------------------------------------------------------
# Step 2: Starting Mock Auth Server & Matching Service Daemon
# ------------------------------------------------------------------------------
echo ""
echo "=== Step 2: Starting Mock Auth Server & Matching Service Daemon ==="

AUTH_PORT="$AUTH_PORT" JWT_SECRET="$JWT_SECRET" node "$ROOT_DIR/tests/integration/mock-auth-server.js" &
AUTH_PID=$!
sleep 1
echo "Mock Auth Server started on port $AUTH_PORT (PID: $AUTH_PID)"

echo "Building Matching Service binary..."
HOST_OS=$(go env GOOS)
HOST_ARCH=$(go env GOARCH)
BIN_EXT=""
if [ "$HOST_OS" = "windows" ]; then
  BIN_EXT=".exe"
fi
MATCHING_BIN="$ROOT_DIR/bin/matching-service${BIN_EXT}"
GOOS="$HOST_OS" GOARCH="$HOST_ARCH" bash "$ROOT_DIR/scripts/build-go-binary.sh" services/matching-service matching-service "$MATCHING_BIN"

rm -f "$MATCHING_LOG"
DYNAMO_TABLE_NAME="$TABLE_NAME" \
DYNAMO_ENDPOINT="$ENDPOINT_URL" \
LOCATION_EVENTS_QUEUE_URL="$LOC_QUEUE_URL" \
RIDE_REQUEST_EVENTS_QUEUE_URL="$RIDE_QUEUE_URL" \
SQS_ENDPOINT="$ENDPOINT_URL" \
AWS_ENDPOINT_URL="$ENDPOINT_URL" \
TRIP_SERVICE_BASE_URL="$INVOKE_URL" \
INTERNAL_API_KEY="$INTERNAL_API_KEY" \
POLL_WAIT_TIME_SECONDS=2 \
"$MATCHING_BIN" > "$MATCHING_LOG" 2>&1 &
MATCHING_PID=$!
sleep 3

if ! kill -0 "$MATCHING_PID" 2>/dev/null; then
  echo "FAIL: Matching Service process crashed on startup!"
  cat "$MATCHING_LOG"
  exit 1
fi
echo "Matching Service daemon active (PID: $MATCHING_PID)"

# ------------------------------------------------------------------------------
# Step 3: Launching Driver & Rider Simulators
# ------------------------------------------------------------------------------
echo ""
echo "=== Step 3: Launching Driver & Rider Simulators ==="
rm -f "$DRIVER_LOG" "$RIDER_LOG"

echo "Spawning $DRIVER_COUNT driver simulations (ID prefix: $RUN_PREFIX)..."
LOCATION_SERVICE_BASE_URL="$INVOKE_URL" \
AUTH_SERVICE_BASE_URL="http://localhost:$AUTH_PORT" \
DRIVER_COUNT="$DRIVER_COUNT" \
DRIVER_ID_PREFIX="$RUN_PREFIX" \
MIN_UPDATE_INTERVAL_MS=1000 \
MAX_UPDATE_INTERVAL_MS=2000 \
npm run start --workspace=@ride-dispatch/driver-simulator > "$DRIVER_LOG" 2>&1 &
DRIVER_SIM_PID=$!

# Give drivers a short head-start (4s) to seed initial location points into GeoIndex
echo "Seeding initial driver spatial coordinates (4s head-start)..."
sleep 4

echo "Spawning $RIDER_COUNT rider simulations (ID prefix: $RUN_PREFIX)..."
TRIP_SERVICE_BASE_URL="$INVOKE_URL" \
AUTH_SERVICE_BASE_URL="http://localhost:$AUTH_PORT" \
RIDER_COUNT="$RIDER_COUNT" \
RIDER_ID_PREFIX="$RUN_PREFIX" \
MIN_REQUEST_INTERVAL_MS=4000 \
MAX_REQUEST_INTERVAL_MS=8000 \
npm run start --workspace=@ride-dispatch/rider-simulator > "$RIDER_LOG" 2>&1 &
RIDER_SIM_PID=$!

echo "Both simulators successfully dispatched into background."

# ------------------------------------------------------------------------------
# Step 4: Running Simulation Traffic
# ------------------------------------------------------------------------------
echo ""
echo "=== Step 4: Running Simulation Traffic (${RUN_DURATION_SECONDS}s) ==="

ELAPSED=0
INTERVAL=15
while [ "$ELAPSED" -lt "$RUN_DURATION_SECONDS" ]; do
  REMAINING=$((RUN_DURATION_SECONDS - ELAPSED))
  SLEEP_CHUNK=$INTERVAL
  if [ "$SLEEP_CHUNK" -gt "$REMAINING" ]; then
    SLEEP_CHUNK=$REMAINING
  fi
  sleep "$SLEEP_CHUNK"
  ELAPSED=$((ELAPSED + SLEEP_CHUNK))
  echo "  [Progress] Traffic elapsed: ${ELAPSED}s / ${RUN_DURATION_SECONDS}s (Active Drivers: $DRIVER_COUNT, Active Riders: $RIDER_COUNT)"

  if ! kill -0 "$MATCHING_PID" 2>/dev/null; then
    echo "ERROR: Matching Service process terminated unexpectedly during simulation!"
    cat "$MATCHING_LOG"
    exit 1
  fi
done

# ------------------------------------------------------------------------------
# Step 5: Stopping Simulators & Generating Final Report
# ------------------------------------------------------------------------------
echo ""
echo "=== Step 5: Stopping Simulators & Generating Report ==="
echo "Stopping Driver Simulator (PID: $DRIVER_SIM_PID)..."
cleanup_process "$DRIVER_SIM_PID" "Driver Simulator"
DRIVER_SIM_PID=""

echo "Stopping Rider Simulator (PID: $RIDER_SIM_PID)..."
cleanup_process "$RIDER_SIM_PID" "Rider Simulator"
RIDER_SIM_PID=""

# Allow 4 seconds for in-flight matches to settle through SQS and Trip Service
echo "Waiting 4s for in-flight matching confirmations to settle..."
sleep 4

echo "Invoking report generator..."
REPORT_STATUS=0
INVOKE_URL="$INVOKE_URL" \
JWT_SECRET="$JWT_SECRET" \
RIDER_COUNT="$RIDER_COUNT" \
DRIVER_COUNT="$DRIVER_COUNT" \
RUN_DURATION_SECONDS="$RUN_DURATION_SECONDS" \
RIDER_ID_PREFIX="$RUN_PREFIX" \
MIN_MATCH_SUCCESS_RATE="$MIN_MATCH_SUCCESS_RATE" \
node "$ROOT_DIR/tests/integration/e2e-reporter.js" || REPORT_STATUS=$?

if [ "$REPORT_STATUS" -ne 0 ]; then
  echo ""
  echo "=== Matching Service Daemon Log Tail (Last 50 Lines) ==="
  tail -n 50 "$MATCHING_LOG" || true
  echo "========================================================"
  exit 1
fi

exit 0
