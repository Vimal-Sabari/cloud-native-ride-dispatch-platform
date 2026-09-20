#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Trip Service End-to-End Integration Test
# ==============================================================================
# Validates Trip Service TypeScript Lambdas, unified API Gateway REST API,
# JWT Authorizer, and internal shared-secret route against LocalStack:
# 1. POST /riders/{id}/rides with valid JWT -> 201 Created (captures rideId)
# 2. GET /rides/{rideId} with valid JWT -> 200 OK, state == "REQUESTED"
# 3. GET /riders/{id}/rides with valid JWT -> 200 OK, includes rideId
# 4. POST /rides/{rideId}/cancel with valid JWT -> 200 OK, state == "CANCELLED"
# 5. POST /rides/{rideId}/cancel again -> 409 Conflict
# 6. Create 2nd ride, POST /internal/rides/{id}/assign-driver with valid x-internal-api-key
#    -> 200 OK, GET confirms state == "MATCHED" and driverId == "test-driver-1"
# 7. Create 3rd ride, POST /internal/rides/{id}/assign-driver with invalid/missing key
#    -> 401 Unauthorized
# ==============================================================================

ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
TABLE_NAME="${TABLE_NAME:-ride-dispatch-platform-local}"
JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-for-ride-dispatch-local-testing}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-dev-internal-api-key-for-matching-service}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="$REGION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "========================================================"
echo "Trip Service End-to-End Integration Test"
echo "Endpoint:         $ENDPOINT_URL"
echo "Region:           $REGION"
echo "Table Name:       $TABLE_NAME"
echo "Internal API Key: [CONFIGURED]"
echo "========================================================"

# Step 1: Wait for LocalStack health
echo "1. Checking LocalStack health..."
bash "$ROOT_DIR/scripts/wait-for-localstack.sh"

# Step 2: Build Lambda deployment zip artifacts if missing
echo "2. Ensuring Lambda deployment zip artifacts are built..."
if [ ! -f "$ROOT_DIR/services/auth-stub/authorizer.zip" ]; then
  bash "$ROOT_DIR/scripts/build-node-lambda.sh" "$ROOT_DIR/services/auth-stub" src/authorizer.ts authorizer
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

# Step 4: Generate a valid test rider JWT signed with JWT_SECRET
echo "4. Generating valid rider JWT token..."
RIDER_TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'test-rider-1', role: 'rider' },
  '$JWT_SECRET',
  { algorithm: 'HS256', expiresIn: '1h' }
);
process.stdout.write(token);
")

if [ -z "$RIDER_TOKEN" ]; then
  echo "FAIL: Could not generate rider JWT token."
  exit 1
fi
echo "Generated valid test rider JWT."

FAILED=0

# Step 5: Test POST /riders/test-rider-1/rides (request ride)
echo ""
echo "5. Testing POST /riders/test-rider-1/rides (request ride)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/riders/test-rider-1/rides" \
  -H "Authorization: Bearer $RIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pickup":{"lat":37.7749,"lng":-122.4194},"dropoff":{"lat":37.7833,"lng":-122.4167}}')

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

RIDE_ID=$(echo "$HTTP_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.rideId || '');
} catch {
  console.log('');
}
")

if [ "$HTTP_CODE" = "201" ] && [ -n "$RIDE_ID" ]; then
  echo "  [PASS] Ride requested successfully (HTTP 201, rideId: $RIDE_ID)"
else
  echo "  [FAIL] Expected HTTP 201 with rideId, got HTTP $HTTP_CODE (Body: $HTTP_BODY)"
  FAILED=1
fi

# Step 6: Test GET /rides/{rideId}
echo ""
echo "6. Testing GET /rides/$RIDE_ID (get ride details)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X GET "$INVOKE_URL/rides/$RIDE_ID" \
  -H "Authorization: Bearer $RIDER_TOKEN")

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

RIDE_STATE=$(echo "$HTTP_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.state || '');
} catch {
  console.log('');
}
")

if [ "$HTTP_CODE" = "200" ] && [ "$RIDE_STATE" = "REQUESTED" ]; then
  echo "  [PASS] Get ride returned HTTP 200 with state 'REQUESTED'"
else
  echo "  [FAIL] Expected HTTP 200 with state 'REQUESTED', got HTTP $HTTP_CODE (state: $RIDE_STATE, body: $HTTP_BODY)"
  FAILED=1
fi

# Step 7: Test GET /riders/test-rider-1/rides (list rider rides)
echo ""
echo "7. Testing GET /riders/test-rider-1/rides (list rider rides)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X GET "$INVOKE_URL/riders/test-rider-1/rides" \
  -H "Authorization: Bearer $RIDER_TOKEN")

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

CONTAINS_RIDE=$(echo "$HTTP_BODY" | node -e "
const fs = require('fs');
try {
  const items = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const found = Array.isArray(items) && items.some(item => item.rideId === '$RIDE_ID');
  console.log(found ? 'true' : 'false');
} catch {
  console.log('false');
}
")

if [ "$HTTP_CODE" = "200" ] && [ "$CONTAINS_RIDE" = "true" ]; then
  echo "  [PASS] List rider rides returned HTTP 200 and includes rideId $RIDE_ID"
else
  echo "  [FAIL] Expected HTTP 200 containing rideId $RIDE_ID, got HTTP $HTTP_CODE (Body: $HTTP_BODY)"
  FAILED=1
fi

# Step 8: Test POST /rides/{rideId}/cancel
echo ""
echo "8. Testing POST /rides/$RIDE_ID/cancel (cancel ride)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/rides/$RIDE_ID/cancel" \
  -H "Authorization: Bearer $RIDER_TOKEN" \
  -H "Content-Type: application/json")

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

CANCELLED_STATE=$(echo "$HTTP_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.state || '');
} catch {
  console.log('');
}
")

if [ "$HTTP_CODE" = "200" ] && [ "$CANCELLED_STATE" = "CANCELLED" ]; then
  echo "  [PASS] Cancel ride returned HTTP 200 and state 'CANCELLED'"
else
  echo "  [FAIL] Expected HTTP 200 with state 'CANCELLED', got HTTP $HTTP_CODE (Body: $HTTP_BODY)"
  FAILED=1
fi

# Step 9: Test repeated POST /rides/{rideId}/cancel -> 409 Conflict
echo ""
echo "9. Testing repeated POST /rides/$RIDE_ID/cancel (expect 409 Conflict)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/rides/$RIDE_ID/cancel" \
  -H "Authorization: Bearer $RIDER_TOKEN" \
  -H "Content-Type: application/json")

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESP" | tail -n 1)

if [ "$HTTP_CODE" = "409" ]; then
  echo "  [PASS] Repeated cancel returned HTTP 409 Conflict as expected (Body: $HTTP_BODY)"
else
  echo "  [FAIL] Expected HTTP 409 for repeated cancel, got HTTP $HTTP_CODE (Body: $HTTP_BODY)"
  FAILED=1
fi

# Step 10: Create second fresh ride and assign driver via internal route
echo ""
echo "10. Testing POST /internal/rides/{id}/assign-driver with valid x-internal-api-key..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/riders/test-rider-1/rides" \
  -H "Authorization: Bearer $RIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pickup":{"lat":37.7750,"lng":-122.4180},"dropoff":{"lat":37.7890,"lng":-122.4010}}')

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
RIDE_2_ID=$(echo "$HTTP_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.rideId || '');
} catch {
  console.log('');
}
")

if [ -z "$RIDE_2_ID" ]; then
  echo "  [FAIL] Could not create second ride for driver assignment test"
  FAILED=1
else
  echo "  Created second ride: $RIDE_2_ID"
  ASSIGN_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/internal/rides/$RIDE_2_ID/assign-driver" \
    -H "x-internal-api-key: $INTERNAL_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"driverId":"test-driver-1"}')

  ASSIGN_BODY=$(echo "$ASSIGN_RESP" | sed '$d')
  ASSIGN_CODE=$(echo "$ASSIGN_RESP" | tail -n 1)

  if [ "$ASSIGN_CODE" = "200" ]; then
    echo "  [PASS] Internal assign-driver returned HTTP 200"
  else
    echo "  [FAIL] Expected HTTP 200 from internal assign-driver, got HTTP $ASSIGN_CODE (Body: $ASSIGN_BODY)"
    FAILED=1
  fi

  # Confirm state is MATCHED and driverId is set via GET
  GET_RIDE_RESP=$(curl -s -w "\n%{http_code}" -X GET "$INVOKE_URL/rides/$RIDE_2_ID" \
    -H "Authorization: Bearer $RIDER_TOKEN")
  GET_RIDE_BODY=$(echo "$GET_RIDE_RESP" | sed '$d')
  GET_RIDE_CODE=$(echo "$GET_RIDE_RESP" | tail -n 1)

  MATCH_STATE=$(echo "$GET_RIDE_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.state || '');
} catch {
  console.log('');
}
")
  MATCH_DRIVER=$(echo "$GET_RIDE_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.driverId || '');
} catch {
  console.log('');
}
")

  if [ "$GET_RIDE_CODE" = "200" ] && [ "$MATCH_STATE" = "MATCHED" ] && [ "$MATCH_DRIVER" = "test-driver-1" ]; then
    echo "  [PASS] Confirmed ride $RIDE_2_ID state is 'MATCHED' and driverId is 'test-driver-1'"
  else
    echo "  [FAIL] Expected state 'MATCHED' and driverId 'test-driver-1', got HTTP $GET_RIDE_CODE (state: $MATCH_STATE, driverId: $MATCH_DRIVER)"
    FAILED=1
  fi
fi

# Step 11: Create third fresh ride and test unauthenticated assign-driver (expect 401)
echo ""
echo "11. Testing POST /internal/rides/{id}/assign-driver without valid x-internal-api-key (expect 401)..."
HTTP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/riders/test-rider-1/rides" \
  -H "Authorization: Bearer $RIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pickup":{"lat":37.7760,"lng":-122.4170},"dropoff":{"lat":37.7900,"lng":-122.4020}}')

HTTP_BODY=$(echo "$HTTP_RESP" | sed '$d')
RIDE_3_ID=$(echo "$HTTP_BODY" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf-8'));
  console.log(d.rideId || '');
} catch {
  console.log('');
}
")

if [ -z "$RIDE_3_ID" ]; then
  echo "  [FAIL] Could not create third ride for negative auth test"
  FAILED=1
else
  echo "  Created third ride: $RIDE_3_ID"
  # Test with wrong key
  UNAUTH_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/internal/rides/$RIDE_3_ID/assign-driver" \
    -H "x-internal-api-key: wrong-invalid-api-key" \
    -H "Content-Type: application/json" \
    -d '{"driverId":"test-driver-1"}')

  UNAUTH_BODY=$(echo "$UNAUTH_RESP" | sed '$d')
  UNAUTH_CODE=$(echo "$UNAUTH_RESP" | tail -n 1)

  if [ "$UNAUTH_CODE" = "401" ]; then
    echo "  [PASS] Assign-driver rejected invalid internal API key with HTTP 401 (Body: $UNAUTH_BODY)"
  else
    echo "  [FAIL] Expected HTTP 401 for invalid internal API key, got HTTP $UNAUTH_CODE (Body: $UNAUTH_BODY)"
    FAILED=1
  fi

  # Also test with missing key header
  MISSING_RESP=$(curl -s -w "\n%{http_code}" -X POST "$INVOKE_URL/internal/rides/$RIDE_3_ID/assign-driver" \
    -H "Content-Type: application/json" \
    -d '{"driverId":"test-driver-1"}')

  MISSING_BODY=$(echo "$MISSING_RESP" | sed '$d')
  MISSING_CODE=$(echo "$MISSING_RESP" | tail -n 1)

  if [ "$MISSING_CODE" = "401" ]; then
    echo "  [PASS] Assign-driver rejected missing internal API key with HTTP 401 (Body: $MISSING_BODY)"
  else
    echo "  [FAIL] Expected HTTP 401 for missing internal API key, got HTTP $MISSING_CODE (Body: $MISSING_BODY)"
    FAILED=1
  fi
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "========================================================"
  echo "ALL TRIP SERVICE INTEGRATION TESTS PASSED SUCCESSFULLY!"
  echo "========================================================"
  exit 0
else
  echo "========================================================"
  echo "TRIP SERVICE INTEGRATION TEST SUITE FAILED!"
  echo "========================================================"
  exit 1
fi
