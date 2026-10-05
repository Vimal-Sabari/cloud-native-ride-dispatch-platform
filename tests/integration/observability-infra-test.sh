#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Observability Infrastructure Verification Test
# ==============================================================================
# Validates that CloudWatch Observability resources provisioned by Terraform
# in LocalStack conform to expected architectural parameters:
# 1. CloudWatch Dashboard exists, and its DashboardBody is valid JSON containing
#    a non-empty widgets array.
# 2. Both DLQ-depth metric alarms exist (ride-request-dlq and location-events-dlq),
#    with Threshold == 0, ComparisonOperator == "GreaterThanThreshold", and
#    dimensions correctly matching their respective DLQ names.
# ==============================================================================

echo "This test validates resource DEFINITION correctness only. Functional alarm-firing and email delivery can only be verified against real AWS — see docs/infrastructure-setup.md for the manual post-deployment verification procedure."

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
PROJECT_NAME="${PROJECT_NAME:-ride-dispatch-platform}"
ENVIRONMENT="${ENVIRONMENT:-local}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

echo "========================================================"
echo "Observability Infrastructure Verification Test"
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
# 1. Verify CloudWatch Platform Overview Dashboard
# ------------------------------------------------------------------------------
DASHBOARD_NAME="${PROJECT_NAME}-${ENVIRONMENT}-platform-overview"
echo ""
echo "--- Checking CloudWatch Dashboard: $DASHBOARD_NAME ---"

DASHBOARD_OUTPUT=$(aws cloudwatch get-dashboard \
  --dashboard-name "$DASHBOARD_NAME" \
  --endpoint-url "$ENDPOINT_URL" \
  --region "$REGION" 2>&1 || true)

if echo "$DASHBOARD_OUTPUT" | grep -q "DashboardBody"; then
  echo "  [PASS] Dashboard '$DASHBOARD_NAME' retrieved successfully"

  # Extract and parse DashboardBody JSON
  DASHBOARD_BODY=$(echo "$DASHBOARD_OUTPUT" | jq -r '.DashboardBody')

  # Verify DashboardBody is valid JSON and extract widgets count
  WIDGET_COUNT=$(echo "$DASHBOARD_BODY" | jq '.widgets | length' 2>/dev/null || echo "0")

  if [ "$WIDGET_COUNT" -gt 0 ]; then
    echo "  [PASS] DashboardBody contains valid JSON with $WIDGET_COUNT widgets"
  else
    echo "  [FAIL] DashboardBody is empty or does not contain a non-empty 'widgets' array (widget count: $WIDGET_COUNT)"
    FAILED=1
  fi
else
  echo "  [FAIL] Failed to retrieve dashboard '$DASHBOARD_NAME': $DASHBOARD_OUTPUT"
  FAILED=1
fi

# ------------------------------------------------------------------------------
# 2. Verify DLQ-Depth Metric Alarms
# ------------------------------------------------------------------------------
verify_dlq_alarm() {
  local queue_type="$1"
  local alarm_name="${PROJECT_NAME}-${ENVIRONMENT}-${queue_type}-dlq-depth"
  local expected_queue_name="${PROJECT_NAME}-${ENVIRONMENT}-${queue_type}-dlq"

  echo ""
  echo "--- Checking DLQ Alarm: $alarm_name ---"

  local ALARM_JSON
  ALARM_JSON=$(aws cloudwatch describe-alarms \
    --alarm-names "$alarm_name" \
    --endpoint-url "$ENDPOINT_URL" \
    --region "$REGION" \
    --output json 2>&1 || true)

  local FOUND_ALARM
  FOUND_ALARM=$(echo "$ALARM_JSON" | jq -r ".MetricAlarms[] | select(.AlarmName == \"$alarm_name\") | .AlarmName" 2>/dev/null || echo "")

  if [ -z "$FOUND_ALARM" ] || [ "$FOUND_ALARM" = "null" ]; then
    echo "  [FAIL] Alarm '$alarm_name' not found in describe-alarms output"
    FAILED=1
    return
  fi
  echo "  [PASS] Alarm '$alarm_name' exists"

  local COMPARISON_OPERATOR THRESHOLD QUEUE_DIMENSION
  COMPARISON_OPERATOR=$(echo "$ALARM_JSON" | jq -r ".MetricAlarms[] | select(.AlarmName == \"$alarm_name\") | .ComparisonOperator")
  THRESHOLD=$(echo "$ALARM_JSON" | jq -r ".MetricAlarms[] | select(.AlarmName == \"$alarm_name\") | .Threshold")
  QUEUE_DIMENSION=$(echo "$ALARM_JSON" | jq -r ".MetricAlarms[] | select(.AlarmName == \"$alarm_name\") | .Dimensions[] | select(.Name == \"QueueName\") | .Value")

  assert_equals "ComparisonOperator is GreaterThanThreshold" "$COMPARISON_OPERATOR" "GreaterThanThreshold"
  assert_equals "Threshold is 0" "$THRESHOLD" "0"
  assert_equals "QueueName dimension matches expected DLQ" "$QUEUE_DIMENSION" "$expected_queue_name"
}

verify_dlq_alarm "ride-request"
verify_dlq_alarm "location-events"

echo ""
echo "========================================================"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL OBSERVABILITY INFRASTRUCTURE TESTS PASSED"
  echo "========================================================"
  exit 0
else
  echo "SOME OBSERVABILITY INFRASTRUCTURE TESTS FAILED"
  echo "========================================================"
  exit 1
fi
