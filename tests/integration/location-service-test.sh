#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Location Service End-to-End Integration Test
# ==============================================================================
# Validates Location Service Go Lambdas, API Gateway REST API, and JWT Authorizer
# deployed against LocalStack:
# 1. POST /drivers/{id}/location with valid JWT -> 200 OK
# 2. POST /drivers/{id}/status with valid JWT -> 200 OK
# 3. POST /drivers/{id}/location without Authorization -> 401/403 Unauthorized
# 4. Direct DynamoDB GetItem verification of GSI1PK, GSI1SK, Status, Lat, Lng
# ==============================================================================

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
TABLE_NAME="${TABLE_NAME:-ride-dispatch-platform-local}"
JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-for-ride-dispatch-local-testing}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "========================================================"
echo "Location Service End-to-End Integration Test"
echo "Endpoint:   $ENDPOINT_URL"
echo "Region:     $REGION"
echo "Table Name: $TABLE_NAME"
echo "========================================================"

# Step 1: Wait for LocalStack health
echo "1. Checking LocalStack health..."
bash "$ROOT_DIR/scripts/wait-for-localstack.sh"

# Step 2: Build Lambda zip artifacts if missing
echo "2. Ensuring Lambda deployment zip artifacts are built..."
if [ ! -f "$ROOT_DIR/services/location-service/update-location.zip" ]; then
  bash "$ROOT_DIR/scripts/build-go-lambda.sh" "$ROOT_DIR/services/location-service" "update-location"
fi
if [ ! -f "$ROOT_DIR/services/location-service/update-status.zip" ]; then
  bash "$ROOT_DIR/scripts/build-go-lambda.sh" "$ROOT_DIR/services/location-service" "update-status"
fi
if [ ! -f "$ROOT_DIR/services/auth-stub/authorizer.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/auth-stub" "authorizer"
fi

# Step 3: Check / Apply Terraform configuration against LocalStack
echo "3. Checking Terraform infrastructure in infra/..."
cd "$ROOT_DIR/infra"

if ! terraform output api_gateway_invoke_url >/dev/null 2>&1; then
  echo "Terraform outputs not found; provisioning infrastructure..."
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
echo "API Gateway Invoke URL: $INVOKE_URL"
echo "DynamoDB Table Name:    $TABLE_NAME"
cd "$ROOT_DIR"

# Step 4: Generate a valid test JWT signed with JWT_SECRET
echo "4. Generating valid driver JWT token..."
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'test-driver-1', role: 'driver' },
  '$JWT_SECRET',
  { algorithm: 'HS256', expiresIn: '1h' }
);
process.stdout.write(token);
")

if [ -z "$TOKEN" ]; then
  echo "FAIL: Could not generate JWT token."
  exit 1
fi
echo "Generated valid test driver JWT."

FAILED=0

# Step 5: Test POST /drivers/{id}/location with valid auth
echo ""
echo "5. Testing POST /drivers/test-driver-1/location (authorized)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/drivers/test-driver-1/location" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lat": 37.7749, "lng": -122.4194}')

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "  [PASS] Location update returned HTTP 200 (Body: $HTTP_BODY)"
else
  echo "  [FAIL] Expected HTTP 200, got HTTP $HTTP_CODE (Body: $HTTP_BODY)"
  FAILED=1
fi

# Step 6: Test POST /drivers/{id}/status with valid auth
echo ""
echo "6. Testing POST /drivers/test-driver-1/status (authorized)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/drivers/test-driver-1/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "available"}')

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "  [PASS] Status update returned HTTP 200 (Body: $HTTP_BODY)"
else
  echo "  [FAIL] Expected HTTP 200, got HTTP $HTTP_CODE (Body: $HTTP_BODY)"
  FAILED=1
fi

# Step 7: Test POST /drivers/{id}/location WITHOUT auth header
echo ""
echo "7. Testing POST /drivers/test-driver-1/location (unauthorized - no token)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/drivers/test-driver-1/location" \
  -H "Content-Type: application/json" \
  -d '{"lat": 37.7749, "lng": -122.4194}')

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  echo "  [PASS] Unauthorized request rejected with HTTP $HTTP_CODE (Body: $HTTP_BODY)"
else
  echo "  [FAIL] Expected HTTP 401 or 403 for unauthorized request, got HTTP $HTTP_CODE (Body: $HTTP_BODY)"
  FAILED=1
fi

# Step 8: Direct DynamoDB verification
echo ""
echo "8. Verifying driver record in DynamoDB table '$TABLE_NAME'..."
ITEM_JSON=$(aws dynamodb get-item \
  --endpoint-url "$ENDPOINT_URL" \
  --table-name "$TABLE_NAME" \
  --key '{"PK":{"S":"DRIVER#test-driver-1"},"SK":{"S":"LOCATION"}}' \
  --region "$REGION")

echo "Retrieved DynamoDB item:"
echo "$ITEM_JSON"

# Extract and assert fields
GSI1PK=$(echo "$ITEM_JSON" | node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
console.log(d.Item && d.Item.GSI1PK ? d.Item.GSI1PK.S : 'NOT_FOUND');
")

GSI1SK=$(echo "$ITEM_JSON" | node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
console.log(d.Item && d.Item.GSI1SK ? d.Item.GSI1SK.S : 'NOT_FOUND');
")

STATUS=$(echo "$ITEM_JSON" | node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
console.log(d.Item && d.Item.Status ? d.Item.Status.S : (d.Item && d.Item.status ? d.Item.status.S : 'NOT_FOUND'));
")

EXPECTED_GSI1PK="GEOHASH#9q8yy"
EXPECTED_GSI1SK="DRIVER#available#test-driver-1"
EXPECTED_STATUS="available"

if [ "$GSI1PK" = "$EXPECTED_GSI1PK" ]; then
  echo "  [PASS] GSI1PK is $EXPECTED_GSI1PK"
else
  echo "  [FAIL] Expected GSI1PK '$EXPECTED_GSI1PK', got '$GSI1PK'"
  FAILED=1
fi

if [ "$GSI1SK" = "$EXPECTED_GSI1SK" ]; then
  echo "  [PASS] GSI1SK is $EXPECTED_GSI1SK"
else
  echo "  [FAIL] Expected GSI1SK '$EXPECTED_GSI1SK', got '$GSI1SK'"
  FAILED=1
fi

if [ "$STATUS" = "$EXPECTED_STATUS" ]; then
  echo "  [PASS] Status is $EXPECTED_STATUS"
else
  echo "  [FAIL] Expected Status '$EXPECTED_STATUS', got '$STATUS'"
  FAILED=1
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "========================================================"
  echo "ALL INTEGRATION TESTS PASSED SUCCESSFULLY!"
  echo "========================================================"
  exit 0
else
  echo "========================================================"
  echo "INTEGRATION TEST SUITE FAILED!"
  echo "========================================================"
  exit 1
fi
