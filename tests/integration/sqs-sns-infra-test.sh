#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SQS and SNS Infrastructure Verification Test
# ==============================================================================
# Validates that the SQS queues (location-events, ride-request-events, and their
# respective Dead Letter Queues) and SNS match-events topic provisioned in
# LocalStack conform to expected architectural parameters:
# 1. Main queue URLs resolve successfully via aws sqs get-queue-url.
# 2. RedrivePolicy specifies deadLetterTargetArn matching the DLQ ARN.
# 3. maxReceiveCount equals 5.
# 4. VisibilityTimeout equals 30 seconds.
# 5. MessageRetentionPeriod equals 300s (location) and 3600s (ride-request).
# 6. DLQ MessageRetentionPeriod equals 1209600s (14 days).
# 7. SNS match-events topic is listed and present.
# ==============================================================================

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
PROJECT_NAME="${PROJECT_NAME:-ride-dispatch-platform}"
ENVIRONMENT="${ENVIRONMENT:-local}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

echo "========================================================"
echo "SQS / SNS Infrastructure Verification Test"
echo "Endpoint:    $ENDPOINT_URL"
echo "Region:      $REGION"
echo "Project:     $PROJECT_NAME"
echo "Environment: $ENVIRONMENT"
echo "========================================================"

FAILED=0

assert_equals() {
  local description="$1"
  local actual="$2"
  local expected="$3"

  if [ "$actual" = "$expected" ]; then
    echo "  [PASS] $description (got: $actual)"
  else
    echo "  [FAIL] $description (expected: '$expected', got: '$actual')"
    FAILED=1
  fi
}

# ------------------------------------------------------------------------------
# Test Helper: Verify Queue Configuration
# ------------------------------------------------------------------------------
verify_queue_pair() {
  local queue_prefix="$1"
  local expected_visibility="$2"
  local expected_retention="$3"

  local main_queue_name="${PROJECT_NAME}-${ENVIRONMENT}-${queue_prefix}"
  local dlq_name="${PROJECT_NAME}-${ENVIRONMENT}-${queue_prefix}-dlq"

  echo ""
  echo "--- Verifying Queue Pair: ${main_queue_name} & ${dlq_name} ---"

  # 1. Resolve DLQ URL and ARN
  echo "Resolving DLQ URL for: ${dlq_name}"
  local dlq_url
  dlq_url=$(aws sqs get-queue-url \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-name "$dlq_name" \
    --region "$REGION" \
    --query "QueueUrl" \
    --output text)

  if [ -z "$dlq_url" ] || [ "$dlq_url" = "None" ]; then
    echo "  [FAIL] Failed to resolve URL for DLQ: ${dlq_name}"
    FAILED=1
    return
  fi
  echo "  [PASS] Resolved DLQ URL: ${dlq_url}"

  local dlq_attrs
  dlq_attrs=$(aws sqs get-queue-attributes \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-url "$dlq_url" \
    --attribute-names QueueArn MessageRetentionPeriod \
    --region "$REGION" \
    --output json)

  local dlq_arn
  dlq_arn=$(echo "$dlq_attrs" | python3 -c "import sys, json; print(json.load(sys.stdin)['Attributes']['QueueArn'])")
  local dlq_retention
  dlq_retention=$(echo "$dlq_attrs" | python3 -c "import sys, json; print(json.load(sys.stdin)['Attributes']['MessageRetentionPeriod'])")

  assert_equals "${dlq_name} MessageRetentionPeriod is 14 days (1209600s)" "$dlq_retention" "1209600"

  # 2. Resolve Main Queue URL and Attributes
  echo "Resolving Main Queue URL for: ${main_queue_name}"
  local main_url
  main_url=$(aws sqs get-queue-url \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-name "$main_queue_name" \
    --region "$REGION" \
    --query "QueueUrl" \
    --output text)

  if [ -z "$main_url" ] || [ "$main_url" = "None" ]; then
    echo "  [FAIL] Failed to resolve URL for main queue: ${main_queue_name}"
    FAILED=1
    return
  fi
  echo "  [PASS] Resolved Main Queue URL: ${main_url}"

  local main_attrs
  main_attrs=$(aws sqs get-queue-attributes \
    --endpoint-url "$ENDPOINT_URL" \
    --queue-url "$main_url" \
    --attribute-names RedrivePolicy VisibilityTimeout MessageRetentionPeriod \
    --region "$REGION" \
    --output json)

  local actual_visibility
  actual_visibility=$(echo "$main_attrs" | python3 -c "import sys, json; print(json.load(sys.stdin)['Attributes']['VisibilityTimeout'])")
  assert_equals "${main_queue_name} VisibilityTimeout is ${expected_visibility}s" "$actual_visibility" "$expected_visibility"

  local actual_retention
  actual_retention=$(echo "$main_attrs" | python3 -c "import sys, json; print(json.load(sys.stdin)['Attributes']['MessageRetentionPeriod'])")
  assert_equals "${main_queue_name} MessageRetentionPeriod is ${expected_retention}s" "$actual_retention" "$expected_retention"

  # Parse RedrivePolicy
  local redrive_json
  redrive_json=$(echo "$main_attrs" | python3 -c "import sys, json; print(json.load(sys.stdin)['Attributes'].get('RedrivePolicy', ''))")

  if [ -z "$redrive_json" ]; then
    echo "  [FAIL] RedrivePolicy missing on ${main_queue_name}"
    FAILED=1
    return
  fi

  local target_dlq_arn
  target_dlq_arn=$(python3 -c "import json; print(json.loads('''$redrive_json''').get('deadLetterTargetArn', ''))")
  local max_receive_count
  max_receive_count=$(python3 -c "import json; print(json.loads('''$redrive_json''').get('maxReceiveCount', ''))")

  assert_equals "${main_queue_name} deadLetterTargetArn matches DLQ ARN" "$target_dlq_arn" "$dlq_arn"
  assert_equals "${main_queue_name} maxReceiveCount is 5" "$max_receive_count" "5"
}

# ------------------------------------------------------------------------------
# Test 1: Location Events Queue Pair
# ------------------------------------------------------------------------------
verify_queue_pair "location-events" "30" "300"

# ------------------------------------------------------------------------------
# Test 2: Ride Request Events Queue Pair
# ------------------------------------------------------------------------------
verify_queue_pair "ride-request-events" "30" "3600"

# ------------------------------------------------------------------------------
# Test 3: SNS Match Events Topic Verification
# ------------------------------------------------------------------------------
echo ""
echo "--- Verifying SNS Match Events Topic ---"
EXPECTED_TOPIC_NAME="${PROJECT_NAME}-${ENVIRONMENT}-match-events"
TOPICS_JSON=$(aws sns list-topics \
  --endpoint-url "$ENDPOINT_URL" \
  --region "$REGION" \
  --output json)

MATCHING_TOPIC_ARN=$(echo "$TOPICS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for t in data.get('Topics', []):
    arn = t.get('TopicArn', '')
    if arn.endswith(':$EXPECTED_TOPIC_NAME'):
        print(arn)
        sys.exit(0)
print('NOT_FOUND')
")

if [ "$MATCHING_TOPIC_ARN" != "NOT_FOUND" ]; then
  echo "  [PASS] Found SNS topic '$EXPECTED_TOPIC_NAME' (ARN: $MATCHING_TOPIC_ARN)"
else
  echo "  [FAIL] SNS topic '$EXPECTED_TOPIC_NAME' was not found in list-topics output."
  FAILED=1
fi

# ------------------------------------------------------------------------------
# Summary & Exit
# ------------------------------------------------------------------------------
echo ""
echo "========================================================"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL ASSERTIONS PASSED: SQS/SNS messaging infrastructure verified successfully."
  exit 0
else
  echo "VERIFICATION FAILED: One or more assertions failed."
  exit 1
fi
