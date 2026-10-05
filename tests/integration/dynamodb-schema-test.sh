#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# DynamoDB Schema Verification Test
# ==============================================================================
# Validates that the single-table DynamoDB schema provisioned in LocalStack
# adheres to the required primary key and 3 Global Secondary Index configurations.
# ==============================================================================

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
TABLE_NAME="${TABLE_NAME:-ride-dispatch-platform-local}"
REGION="${AWS_REGION:-us-east-1}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

echo "========================================================"
echo "DynamoDB Schema Verification"
echo "Endpoint:   $ENDPOINT_URL"
echo "Table Name: $TABLE_NAME"
echo "Region:     $REGION"
echo "========================================================"

# Fetch table description from DynamoDB / LocalStack
if ! TABLE_JSON=$(aws dynamodb describe-table \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --region "$REGION" 2>&1); then
  echo "FAIL: Failed to describe table '$TABLE_NAME' from $ENDPOINT_URL"
  echo "$TABLE_JSON"
  exit 1
fi

echo "Table description retrieved successfully."

FAILED=0

# Assertion helper
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

echo ""
echo "Verifying Primary Key Schema..."
PK_TYPE=$(echo "$TABLE_JSON" | python3 -c '
import sys, json
data = json.load(sys.stdin)
for k in data["Table"]["KeySchema"]:
    if k["AttributeName"] == "PK":
        print(k["KeyType"])
        sys.exit(0)
print("NOT_FOUND")
')

SK_TYPE=$(echo "$TABLE_JSON" | python3 -c '
import sys, json
data = json.load(sys.stdin)
for k in data["Table"]["KeySchema"]:
    if k["AttributeName"] == "SK":
        print(k["KeyType"])
        sys.exit(0)
print("NOT_FOUND")
')

assert_equals "KeySchema contains PK as HASH" "$PK_TYPE" "HASH"
assert_equals "KeySchema contains SK as RANGE" "$SK_TYPE" "RANGE"

echo ""
echo "Verifying Global Secondary Indexes..."
GSI_COUNT=$(echo "$TABLE_JSON" | python3 -c '
import sys, json
data = json.load(sys.stdin)
gsis = data["Table"].get("GlobalSecondaryIndexes", [])
print(len(gsis))
')
assert_equals "GlobalSecondaryIndexes count is 4" "$GSI_COUNT" "4"

for GSI_NAME in GSI1 GSI2 GSI3 GSI4; do
  echo "Checking $GSI_NAME..."
  
  HASH_KEY=$(echo "$TABLE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for gsi in data['Table'].get('GlobalSecondaryIndexes', []):
    if gsi['IndexName'] == '$GSI_NAME':
        for k in gsi['KeySchema']:
            if k['KeyType'] == 'HASH':
                print(k['AttributeName'])
                sys.exit(0)
print('NOT_FOUND')
")

  RANGE_KEY=$(echo "$TABLE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for gsi in data['Table'].get('GlobalSecondaryIndexes', []):
    if gsi['IndexName'] == '$GSI_NAME':
        for k in gsi['KeySchema']:
            if k['KeyType'] == 'RANGE':
                print(k['AttributeName'])
                sys.exit(0)
print('NOT_FOUND')
")

  EXPECTED_HASH="${GSI_NAME}PK"
  EXPECTED_RANGE="${GSI_NAME}SK"

  assert_equals "$GSI_NAME HASH key is $EXPECTED_HASH" "$HASH_KEY" "$EXPECTED_HASH"
  assert_equals "$GSI_NAME RANGE key is $EXPECTED_RANGE" "$RANGE_KEY" "$EXPECTED_RANGE"
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "ALL ASSERTIONS PASSED: DynamoDB table schema matches single-table specification."
  exit 0
else
  echo "SCHEMA VERIFICATION FAILED: One or more assertions failed."
  exit 1
fi
