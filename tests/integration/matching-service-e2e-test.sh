#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Matching Service End-to-End Integration Test
# ==============================================================================
# First full cross-service integration test in the platform:
# 1. Verifies LocalStack health & checks/provisions full Terraform infrastructure
#    (DynamoDB single table, streams, Lambda functions, API Gateway, SQS queues).
# 2. Builds Matching Service Go binary via scripts/build-go-binary.sh.
# 3. Launches Matching Service as a background daemon process against LocalStack.
# 4. Updates driver "e2e-test-driver-1" location & availability status via Location
#    Service API.
# 5. Employs a fixed-wait synchronization window allowing DynamoDB Streams forwarder
#    and SQS to deliver the location event to Matching Service's in-memory GeoIndex.
# 6. Posts a ride request for "e2e-test-rider-1" close to the driver via Trip Service.
# 7. Polls GET /rides/{rideId} until state reaches "MATCHED" with driverId == "e2e-test-driver-1".
# 8. Cleans up background process and prints detailed results / daemon logs.
# ==============================================================================

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
TABLE_NAME="${TABLE_NAME:-ride-dispatch-platform-local}"
JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-for-ride-dispatch-local-testing}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-dev-internal-api-key-for-matching-service}"
TEARDOWN="${TEARDOWN:-false}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "========================================================"
echo "Matching Service End-to-End Integration Test"
echo "Endpoint:         $ENDPOINT_URL"
echo "Region:           $REGION"
echo "Table Name:       $TABLE_NAME"
echo "Internal API Key: [CONFIGURED]"
echo "========================================================"

FAILED=0
MATCHING_PID=""
MATCHING_LOG="$ROOT_DIR/matching-service.log"

cleanup() {
  echo ""
  echo "Cleaning up Matching Service background process..."
  if [ -n "$MATCHING_PID" ]; then
    kill "$MATCHING_PID" 2>/dev/null || true
    sleep 1
    if kill -0 "$MATCHING_PID" 2>/dev/null; then
      if command -v taskkill >/dev/null 2>&1; then
        taskkill //PID "$MATCHING_PID" //F >/dev/null 2>&1 || true
      else
        kill -9 "$MATCHING_PID" 2>/dev/null || true
      fi
    fi
  fi

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
# Step 1: Check LocalStack health
# ------------------------------------------------------------------------------
echo "1. Checking LocalStack health..."
bash "$ROOT_DIR/scripts/wait-for-localstack.sh"

# ------------------------------------------------------------------------------
# Step 2: Build Lambda artifacts if missing
# ------------------------------------------------------------------------------
echo "2. Ensuring Lambda deployment zip artifacts are built..."
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

# ------------------------------------------------------------------------------
# Step 3: Check / Apply Terraform infrastructure
# ------------------------------------------------------------------------------
echo "3. Checking Terraform infrastructure in infra/..."
cd "$ROOT_DIR/infra"

if ! terraform output api_gateway_invoke_url >/dev/null 2>&1; then
  echo "Terraform outputs not found; provisioning infrastructure against LocalStack..."
  if [ -f "backend.tf" ]; then
    mv backend.tf backend.tf.bak
  fi
  terraform init
  terraform plan -input=false -var-file=local.tfvars -out=tfplan
  terraform apply -input=false tfplan
else
  echo "Terraform infrastructure is already provisioned."
fi

INVOKE_URL=$(terraform output -raw api_gateway_invoke_url)
INVOKE_URL="${INVOKE_URL%/}"
TABLE_NAME=$(terraform output -raw dynamodb_table_name 2>/dev/null || echo "$TABLE_NAME")
LOC_QUEUE_URL=$(terraform output -raw location_events_queue_url)
RIDE_QUEUE_URL=$(terraform output -raw ride_request_events_queue_url)

echo "API Gateway Invoke URL:    $INVOKE_URL"
echo "DynamoDB Table:           $TABLE_NAME"
echo "Location Queue URL:       $LOC_QUEUE_URL"
echo "Ride Request Queue URL:   $RIDE_QUEUE_URL"
cd "$ROOT_DIR"

# Purge any residual messages from prior runs
aws sqs purge-queue --endpoint-url "$ENDPOINT_URL" --queue-url "$LOC_QUEUE_URL" 2>/dev/null || true
aws sqs purge-queue --endpoint-url "$ENDPOINT_URL" --queue-url "$RIDE_QUEUE_URL" 2>/dev/null || true

# ------------------------------------------------------------------------------
# Step 4: Build Matching Service Binary for Host OS
# ------------------------------------------------------------------------------
echo ""
echo "4. Building Matching Service binary for local host..."
HOST_OS=$(go env GOOS)
HOST_ARCH=$(go env GOARCH)
BIN_EXT=""
if [ "$HOST_OS" = "windows" ]; then
  BIN_EXT=".exe"
fi
MATCHING_BIN="$ROOT_DIR/bin/matching-service${BIN_EXT}"
GOOS="$HOST_OS" GOARCH="$HOST_ARCH" bash "$ROOT_DIR/scripts/build-go-binary.sh" services/matching-service matching-service "$MATCHING_BIN"

# ------------------------------------------------------------------------------
# Step 5: Launch Matching Service as a background daemon
# ------------------------------------------------------------------------------
echo ""
echo "5. Launching Matching Service daemon in background..."
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
echo "Matching Service running with PID $MATCHING_PID, logging to $MATCHING_LOG"

# Wait a few seconds for initialization and queue polling
sleep 4

if ! kill -0 "$MATCHING_PID" 2>/dev/null; then
  echo "FAIL: Matching Service process crashed immediately upon startup!"
  cat "$MATCHING_LOG"
  exit 1
fi
echo "Matching Service is actively running and polling."

# ------------------------------------------------------------------------------
# Step 6: Post driver location & status update
# ------------------------------------------------------------------------------
echo ""
echo "6. Registering simulated driver location and status..."
DRIVER_ID="e2e-test-driver-1"
DRIVER_LAT=37.7749
DRIVER_LNG=-122.4194

DRIVER_TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: '$DRIVER_ID', role: 'driver' },
  '$JWT_SECRET',
  { algorithm: 'HS256', expiresIn: '1h' }
);
process.stdout.write(token);
")

echo "Posting driver location ($DRIVER_LAT, $DRIVER_LNG)..."
curl -s -f -X POST "$INVOKE_URL/drivers/$DRIVER_ID/location" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"lat\": $DRIVER_LAT, \"lng\": $DRIVER_LNG}" >/dev/null

echo "Posting driver status (available)..."
curl -s -f -X POST "$INVOKE_URL/drivers/$DRIVER_ID/status" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "available"}' >/dev/null

echo "Driver update submitted successfully."

# ------------------------------------------------------------------------------
# Step 7: Synchronization wait for location event ingestion
# ------------------------------------------------------------------------------
# DOCUMENTED SYNCHRONIZATION DESIGN:
# Since Matching Service's spatial index is maintained purely in memory, there is
# no external API or port to query its internal state directly from this black-box
# test. We employ a generous fixed wait window (12 seconds) allowing the DynamoDB
# stream event to be captured by the forwarder Lambda, delivered to SQS, and consumed
# by Matching Service's long-polling worker.
echo ""
echo "7. Waiting 12 seconds for location event propagation through Streams -> SQS -> Matching Service GeoIndex..."
sleep 12

# ------------------------------------------------------------------------------
# Step 8: Post Ride Request
# ------------------------------------------------------------------------------
echo ""
echo "8. Requesting ride for e2e-test-rider-1 close to driver location..."
RIDER_ID="e2e-test-rider-1"
RIDER_TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: '$RIDER_ID', role: 'rider' },
  '$JWT_SECRET',
  { algorithm: 'HS256', expiresIn: '1h' }
);
process.stdout.write(token);
")

RIDE_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/riders/$RIDER_ID/rides" \
  -H "Authorization: Bearer $RIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"pickup\":{\"lat\":$DRIVER_LAT,\"lng\":$DRIVER_LNG},\"dropoff\":{\"lat\":37.7833,\"lng\":-122.4167}}")

RIDE_BODY=$(echo "$RIDE_RESP" | sed '$d')
RIDE_CODE=$(echo "$RIDE_RESP" | tail -n 1)

RIDE_ID=$(echo "$RIDE_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.rideId || '');
} catch {
  console.log('');
}
")

if [ "$RIDE_CODE" = "201" ] && [ -n "$RIDE_ID" ]; then
  echo "  [PASS] Ride created successfully (HTTP 201, rideId: $RIDE_ID)"
else
  echo "  [FAIL] Failed to create ride, got HTTP $RIDE_CODE: $RIDE_BODY"
  exit 1
fi

# ------------------------------------------------------------------------------
# Step 9: Poll GET /rides/{rideId} until MATCHED
# ------------------------------------------------------------------------------
echo ""
echo "9. Polling GET /rides/$RIDE_ID for MATCHED state (timeout: 30s)..."
MATCHED=0
ASSIGNED_DRIVER=""

for i in {1..15}; do
  GET_RESP=$(curl -s -X GET "$INVOKE_URL/rides/$RIDE_ID" \
    -H "Authorization: Bearer $RIDER_TOKEN")

  RIDE_STATE=$(echo "$GET_RESP" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.state || '');
} catch {
  console.log('');
}
")

  ASSIGNED_DRIVER=$(echo "$GET_RESP" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.driverId || '');
} catch {
  console.log('');
}
")

  echo "  Check $i/15: ride state = '${RIDE_STATE:-UNKNOWN}', driverId = '${ASSIGNED_DRIVER:-NONE}'"

  if [ "$RIDE_STATE" = "MATCHED" ]; then
    MATCHED=1
    break
  fi

  sleep 2
done

# ------------------------------------------------------------------------------
# Step 10: Validation Assertions & Summary
# ------------------------------------------------------------------------------
echo ""
echo "10. Validating End-to-End Match Result..."
if [ "$MATCHED" -eq 1 ] && [ "$ASSIGNED_DRIVER" = "$DRIVER_ID" ]; then
  echo "  [PASS] Ride successfully transitioned to MATCHED!"
  echo "  [PASS] Driver assigned matches expected: $ASSIGNED_DRIVER"
else
  echo "  [FAIL] Ride did not reach MATCHED state with driver $DRIVER_ID within timeout."
  FAILED=1
fi

echo ""
echo "=== Matching Service Log Output ==="
cat "$MATCHING_LOG" || true
echo "==================================="

if [ "$FAILED" -eq 0 ]; then
  echo ""
  echo "========================================================"
  echo "ALL MATCHING SERVICE E2E INTEGRATION TESTS PASSED!"
  echo "========================================================"
  exit 0
else
  echo ""
  echo "========================================================"
  echo "MATCHING SERVICE E2E INTEGRATION TEST SUITE FAILED!"
  echo "========================================================"
  exit 1
fi
