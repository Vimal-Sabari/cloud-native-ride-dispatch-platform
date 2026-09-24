#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Event Forwarder Integration Test
# ==============================================================================
# Validates that the DynamoDB Streams -> SQS event forwarder Lambda correctly:
# 1. Forwards driver LOCATION writes to the location-events queue.
# 2. Forwards ride REQUESTED writes to the ride-request-events queue.
# 3. Ignores unrelated records (e.g. GSI3 active ride pointers), producing no
#    messages on either queue.
# ==============================================================================

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
PROJECT_NAME="${PROJECT_NAME:-ride-dispatch-platform}"
ENVIRONMENT="${ENVIRONMENT:-local}"
TABLE_NAME="${TABLE_NAME:-${PROJECT_NAME}-${ENVIRONMENT}}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

echo "========================================================"
echo "Event Forwarder Integration Test"
echo "Endpoint:    $ENDPOINT_URL"
echo "Region:      $REGION"
echo "Table Name:  $TABLE_NAME"
echo "========================================================"

FAILED=0

# Helper to resolve queue URL
get_queue_url() {
  local queue_name="$1"
  aws sqs get-queue-url \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-name "$queue_name" \
    --region "$REGION" \
    --query "QueueUrl" \
    --output text
}

LOC_QUEUE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-location-events"
RIDE_QUEUE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-ride-request-events"

echo "Resolving SQS Queue URLs..."
LOC_QUEUE_URL=$(get_queue_url "$LOC_QUEUE_NAME")
RIDE_QUEUE_URL=$(get_queue_url "$RIDE_QUEUE_NAME")
echo "Location Events Queue URL:     $LOC_QUEUE_URL"
echo "Ride Request Events Queue URL: $RIDE_QUEUE_URL"

# Purge any stale messages from prior tests
aws sqs purge-queue --endpoint-url "$ENDPOINT_URL" --queue-url "$LOC_QUEUE_URL" 2>/dev/null || true
aws sqs purge-queue --endpoint-url "$ENDPOINT_URL" --queue-url "$RIDE_QUEUE_URL" 2>/dev/null || true
sleep 1

# ------------------------------------------------------------------------------
# Test 1: Location write forward to location-events queue
# ------------------------------------------------------------------------------
echo ""
echo "--- Test 1: Location write forwarding ---"
TEST_DRIVER_ID="test-driver-fwd-$RANDOM"
echo "Writing driver location item for driver: $TEST_DRIVER_ID..."

aws dynamodb put-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item "{
    \"PK\": {\"S\": \"DRIVER#${TEST_DRIVER_ID}\"},
    \"SK\": {\"S\": \"LOCATION\"},
    \"GSI1PK\": {\"S\": \"GEOHASH#u4pruy\"},
    \"GSI1SK\": {\"S\": \"DRIVER#available#${TEST_DRIVER_ID}\"},
    \"driverId\": {\"S\": \"${TEST_DRIVER_ID}\"},
    \"status\": {\"S\": \"available\"},
    \"lat\": {\"N\": \"37.7749\"},
    \"lng\": {\"N\": \"-122.4194\"},
    \"updatedAt\": {\"S\": \"2026-09-25T00:00:00Z\"}
  }"

echo "Polling location-events queue (timeout 20s)..."
FOUND_LOC=0
for i in {1..10}; do
  MSG_JSON=$(aws sqs receive-message \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-url "$LOC_QUEUE_URL" \
    --region "$REGION" \
    --max-number-of-messages 10 \
    --output json)

  if echo "$MSG_JSON" | grep -q "$TEST_DRIVER_ID"; then
    echo "  [PASS] Found message containing driverId '$TEST_DRIVER_ID' in location-events queue"
    FOUND_LOC=1
    break
  fi
  sleep 2
done

if [ "$FOUND_LOC" -eq 0 ]; then
  echo "  [FAIL] Timed out waiting for location update message for driver '$TEST_DRIVER_ID'"
  FAILED=1
fi

# ------------------------------------------------------------------------------
# Test 2: Ride request write forward to ride-request-events queue
# ------------------------------------------------------------------------------
echo ""
echo "--- Test 2: Ride request write forwarding ---"
TEST_RIDE_ID="test-ride-fwd-$RANDOM"
TEST_RIDER_ID="test-rider-fwd-$RANDOM"
echo "Writing ride details item for ride: $TEST_RIDE_ID..."

aws dynamodb put-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item "{
    \"PK\": {\"S\": \"RIDE#${TEST_RIDE_ID}\"},
    \"SK\": {\"S\": \"DETAILS\"},
    \"GSI2PK\": {\"S\": \"RIDER#${TEST_RIDER_ID}\"},
    \"GSI2SK\": {\"S\": \"RIDE#2026-09-25T00:00:00Z#${TEST_RIDE_ID}\"},
    \"rideId\": {\"S\": \"${TEST_RIDE_ID}\"},
    \"riderId\": {\"S\": \"${TEST_RIDER_ID}\"},
    \"state\": {\"S\": \"REQUESTED\"},
    \"pickup\": {\"M\": {
      \"lat\": {\"N\": \"37.7749\"},
      \"lng\": {\"N\": \"-122.4194\"}
    }},
    \"dropoff\": {\"M\": {
      \"lat\": {\"N\": \"37.7833\"},
      \"lng\": {\"N\": \"-122.4167\"}
    }},
    \"createdAt\": {\"S\": \"2026-09-25T00:00:00Z\"}
  }"

echo "Polling ride-request-events queue (timeout 20s)..."
FOUND_RIDE=0
for i in {1..10}; do
  MSG_JSON=$(aws sqs receive-message \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-url "$RIDE_QUEUE_URL" \
    --region "$REGION" \
    --max-number-of-messages 10 \
    --output json)

  if echo "$MSG_JSON" | grep -q "$TEST_RIDE_ID"; then
    echo "  [PASS] Found message containing rideId '$TEST_RIDE_ID' in ride-request-events queue"
    FOUND_RIDE=1
    break
  fi
  sleep 2
done

if [ "$FOUND_RIDE" -eq 0 ]; then
  echo "  [FAIL] Timed out waiting for ride-requested message for ride '$TEST_RIDE_ID'"
  FAILED=1
fi

# ------------------------------------------------------------------------------
# Test 3: Negative test - Unrelated record should NOT be forwarded
# ------------------------------------------------------------------------------
echo ""
echo "--- Test 3: Negative test - Unrelated record not forwarded ---"
TEST_IGNORED_ID="test-pointer-$RANDOM"
echo "Writing GSI3 active ride pointer (non-forwarded entity): $TEST_IGNORED_ID..."

aws dynamodb put-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item "{
    \"PK\": {\"S\": \"DRIVER#${TEST_IGNORED_ID}\"},
    \"SK\": {\"S\": \"ACTIVE_RIDE_POINTER\"},
    \"GSI3PK\": {\"S\": \"DRIVER#${TEST_IGNORED_ID}\"},
    \"GSI3SK\": {\"S\": \"ACTIVE_RIDE\"},
    \"rideId\": {\"S\": \"some-other-ride\"}
  }"

echo "Waiting 6s to confirm no message is published to either queue..."
sleep 6

MSG_LOC_CHECK=$(aws sqs receive-message \
  --endpoint-url "$ENDPOINT_URL" \
  --queue-url "$LOC_QUEUE_URL" \
  --region "$REGION" \
  --max-number-of-messages 10 \
  --output json || echo "{}")

MSG_RIDE_CHECK=$(aws sqs receive-message \
  --endpoint-url "$ENDPOINT_URL" \
  --queue-url "$RIDE_QUEUE_URL" \
  --region "$REGION" \
  --max-number-of-messages 10 \
  --output json || echo "{}")

if echo "$MSG_LOC_CHECK" | grep -q "$TEST_IGNORED_ID" || echo "$MSG_RIDE_CHECK" | grep -q "$TEST_IGNORED_ID"; then
  echo "  [FAIL] Record '$TEST_IGNORED_ID' was unexpectedly forwarded to a queue!"
  FAILED=1
else
  echo "  [PASS] No message for '$TEST_IGNORED_ID' appeared on either queue."
fi

# ------------------------------------------------------------------------------
# Summary & Exit
# ------------------------------------------------------------------------------
echo ""
echo "========================================================"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL ASSERTIONS PASSED: Event forwarder integration test succeeded."
  exit 0
else
  echo "INTEGRATION TEST FAILED: One or more assertions failed."
  exit 1
fi
