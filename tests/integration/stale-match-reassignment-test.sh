#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Stale Match Reassignment Integration Test (Module 27)
# ==============================================================================
# Validates the fault-tolerant driver-accept timeout reassignment:
# 1. Seeds a ride record in MATCHED state with a backdated updatedAt (120s ago).
# 2. Seeds an associated driver record in "busy" status.
# 3. Invokes the reassign-stale-matches Lambda directly via AWS CLI.
# 4. Verifies the ride state transitions to "REQUESTED".
# 5. Verifies the driver status resets to "available".
# 6. Verifies a correctly-shaped "ride-requested" event is received on the
#    ride-request-events SQS queue.
# ==============================================================================

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
PROJECT_NAME="${PROJECT_NAME:-ride-dispatch-platform}"
ENVIRONMENT="${ENVIRONMENT:-local}"
TABLE_NAME="${TABLE_NAME:-${PROJECT_NAME}-${ENVIRONMENT}}"
FUNCTION_NAME="${FUNCTION_NAME:-${PROJECT_NAME}-${ENVIRONMENT}-trip-reassign-stale-matches}"
QUEUE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-ride-request-events"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$ROOT_DIR/services/trip-service/reassign-stale-matches.zip" ]; then
  echo "Building reassign-stale-matches.zip artifact..."
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/trip-service" src/handlers/reassign-stale-matches-entry.ts reassign-stale-matches
fi

echo "========================================================"
echo "Stale Match Reassignment Integration Test"
echo "Endpoint:      $ENDPOINT_URL"
echo "Region:        $REGION"
echo "Table Name:    $TABLE_NAME"
echo "Function Name: $FUNCTION_NAME"
echo "Queue Name:    $QUEUE_NAME"
echo "========================================================"

FAILED=0

# Helper to resolve queue URL
get_queue_url() {
  aws sqs get-queue-url \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-name "$QUEUE_NAME" \
    --region "$REGION" \
    --query "QueueUrl" \
    --output text
}

QUEUE_URL=$(get_queue_url)
echo "Resolved Queue URL: $QUEUE_URL"

# Purge queue prior to test
echo "Purging ride-request-events queue..."
aws sqs purge-queue --endpoint-url "$ENDPOINT_URL" --queue-url "$QUEUE_URL" 2>/dev/null || true
sleep 1

# Generate test identifiers and backdated timestamp (120 seconds in the past)
TEST_RIDE_ID="stale-ride-$RANDOM-$RANDOM"
TEST_DRIVER_ID="stale-driver-$RANDOM-$RANDOM"
TEST_RIDER_ID="stale-rider-$RANDOM-$RANDOM"
BACKDATED_TIME=$(node -e "console.log(new Date(Date.now() - 120000).toISOString())")

echo "Seeding test ride '$TEST_RIDE_ID' in MATCHED state (updatedAt: $BACKDATED_TIME)..."
aws dynamodb put-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item "{
    \"PK\": {\"S\": \"RIDE#${TEST_RIDE_ID}\"},
    \"SK\": {\"S\": \"DETAILS\"},
    \"rideId\": {\"S\": \"${TEST_RIDE_ID}\"},
    \"riderId\": {\"S\": \"${TEST_RIDER_ID}\"},
    \"driverId\": {\"S\": \"${TEST_DRIVER_ID}\"},
    \"state\": {\"S\": \"MATCHED\"},
    \"pickup\": {\"M\": {\"lat\": {\"N\": \"37.7749\"}, \"lng\": {\"N\": \"-122.4194\"}}},
    \"dropoff\": {\"M\": {\"lat\": {\"N\": \"37.7833\"}, \"lng\": {\"N\": \"-122.4167\"}}},
    \"createdAt\": {\"S\": \"${BACKDATED_TIME}\"},
    \"updatedAt\": {\"S\": \"${BACKDATED_TIME}\"},
    \"GSI4PK\": {\"S\": \"STATE#MATCHED\"},
    \"GSI4SK\": {\"S\": \"${BACKDATED_TIME}\"}
  }"

echo "Seeding test driver '$TEST_DRIVER_ID' in 'busy' status..."
aws dynamodb put-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item "{
    \"PK\": {\"S\": \"DRIVER#${TEST_DRIVER_ID}\"},
    \"SK\": {\"S\": \"LOCATION\"},
    \"driverId\": {\"S\": \"${TEST_DRIVER_ID}\"},
    \"status\": {\"S\": \"busy\"},
    \"GSI1PK\": {\"S\": \"GEOHASH#9q8yy\"},
    \"GSI1SK\": {\"S\": \"DRIVER#busy#${TEST_DRIVER_ID}\"},
    \"lat\": {\"N\": \"37.7750\"},
    \"lng\": {\"N\": \"-122.4190\"},
    \"updatedAt\": {\"S\": \"${BACKDATED_TIME}\"}
  }"

# Seed active ride pointer
aws dynamodb put-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item "{
    \"PK\": {\"S\": \"DRIVER#${TEST_DRIVER_ID}\"},
    \"SK\": {\"S\": \"ACTIVE_RIDE_POINTER\"},
    \"GSI3PK\": {\"S\": \"DRIVER#${TEST_DRIVER_ID}\"},
    \"GSI3SK\": {\"S\": \"ACTIVE_RIDE\"},
    \"rideId\": {\"S\": \"${TEST_RIDE_ID}\"}
  }"

# Invoke reassign-stale-matches Lambda
RESPONSE_FILE=$(mktemp 2>/dev/null || echo "/tmp/reassign-resp-$RANDOM.json")
echo "Invoking $FUNCTION_NAME directly..."
aws lambda invoke \
  --endpoint-url "$ENDPOINT_URL" \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  "$RESPONSE_FILE"

echo "Lambda response:"
cat "$RESPONSE_FILE"
echo ""

# Verify Ride state became REQUESTED
echo "Verifying ride state in DynamoDB..."
RIDE_STATE=$(aws dynamodb get-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --key "{\"PK\":{\"S\":\"RIDE#${TEST_RIDE_ID}\"},\"SK\":{\"S\":\"DETAILS\"}}" \
  --query "Item.state.S" \
  --output text)

if [ "$RIDE_STATE" = "REQUESTED" ]; then
  echo "  [PASS] Ride state is REQUESTED"
else
  echo "  [FAIL] Expected ride state REQUESTED, got: '$RIDE_STATE'"
  FAILED=1
fi

# Verify Driver status became available
echo "Verifying driver status in DynamoDB..."
DRIVER_STATUS=$(aws dynamodb get-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --key "{\"PK\":{\"S\":\"DRIVER#${TEST_DRIVER_ID}\"},\"SK\":{\"S\":\"LOCATION\"}}" \
  --query "Item.status.S" \
  --output text)

if [ "$DRIVER_STATUS" = "available" ]; then
  echo "  [PASS] Driver status is available"
else
  echo "  [FAIL] Expected driver status available, got: '$DRIVER_STATUS'"
  FAILED=1
fi

# Verify re-enqueue message arrived on SQS queue
echo "Polling ride-request-events queue for re-enqueue event..."
FOUND_SQS=0
for i in {1..10}; do
  SQS_RES=$(aws sqs receive-message \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-url "$QUEUE_URL" \
    --region "$REGION" \
    --max-number-of-messages 10 \
    --wait-time-seconds 2 || echo "")

  if [ -n "$SQS_RES" ] && echo "$SQS_RES" | grep -q "$TEST_RIDE_ID"; then
    echo "  [PASS] Received re-enqueued SQS message for ride: $TEST_RIDE_ID"
    # Verify shape
    if echo "$SQS_RES" | grep -q '"eventType":"ride-requested"'; then
      echo "  [PASS] Event contains eventType: ride-requested"
    else
      echo "  [FAIL] Event missing eventType: ride-requested"
      FAILED=1
    fi
    FOUND_SQS=1
    break
  fi
  sleep 1
done

if [ "$FOUND_SQS" -eq 0 ]; then
  echo "  [FAIL] Timed out waiting for re-enqueued ride-requested message on $QUEUE_URL"
  FAILED=1
fi

# Clean up temporary response file
rm -f "$RESPONSE_FILE" 2>/dev/null || true

echo "========================================================"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL CHECKS PASSED: Stale match reassignment works end-to-end!"
  exit 0
else
  echo "TEST FAILED: One or more assertions failed."
  exit 1
fi
