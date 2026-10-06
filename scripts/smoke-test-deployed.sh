#!/usr/bin/env bash
set -uo pipefail

# ==============================================================================
# Smoke Test Deployed AWS Environment
# ==============================================================================
# Performs a lightweight sanity check against the real deployed API Gateway URL.
# Validates core HTTP request/response flows without initiating a full E2E match:
# 1. POST /auth/token for test driver -> HTTP 200 + token received.
# 2. POST /drivers/{id}/location -> HTTP 200 with driver token.
# 3. POST /auth/token for test rider -> HTTP 200 + token received.
# 4. POST /riders/{id}/rides -> HTTP 201 + rideId returned.
# 5. GET /rides/{id} -> HTTP 200 + state is REQUESTED.
#
# Usage:
#   bash scripts/smoke-test-deployed.sh <api-gateway-base-url>
# Example:
#   bash scripts/smoke-test-deployed.sh https://abc123xyz.execute-api.us-east-1.amazonaws.com/aws-dev
# ==============================================================================

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "Error: Missing API Gateway base URL argument."
  echo "Usage: $0 <api-gateway-base-url>"
  echo "Example: $0 https://abc123xyz.execute-api.us-east-1.amazonaws.com/aws-dev"
  exit 1
fi

BASE_URL="${1%/}"
# AUTH_URL defaults to BASE_URL, allowing an external auth endpoint override if configured
AUTH_URL="${AUTH_URL:-$BASE_URL}"
AUTH_URL="${AUTH_URL%/}"

echo "======================================================================"
echo "Starting Smoke Test against Deployed API Gateway"
echo "Target Base URL: $BASE_URL"
echo "Auth Base URL:   $AUTH_URL"
echo "======================================================================"

FAILURES=0

# Helper to extract JSON field using jq, node, or python
extract_json_field() {
  local json="$1"
  local field="$2"
  if command -v jq >/dev/null 2>&1; then
    echo "$json" | jq -r ".$field // empty"
  elif command -v node >/dev/null 2>&1; then
    node -e "try { const d = JSON.parse(process.argv[1]); console.log(d['$field'] || ''); } catch(e) { console.log(''); }" "$json"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys, json; d=json.loads(sys.argv[1]) if sys.argv[1] else {}; print(d.get('$field', ''))" "$json"
  else
    # Fallback grep/sed extraction
    echo "$json" | grep -o "\"$field\":\"[^\"]*\"" | cut -d':' -f2 | tr -d '"'
  fi
}

# ------------------------------------------------------------------------------
# Test 1: POST /auth/token for test driver
# ------------------------------------------------------------------------------
echo ""
echo "[Test 1/5] Requesting test driver auth token..."
DRIVER_ID="smoke-test-driver-$(date +%s)"
DRIVER_AUTH_BODY="{\"subjectId\":\"${DRIVER_ID}\",\"role\":\"driver\"}"

AUTH_RESP=$(curl -s -w "\n%{http_code}" -X POST "${AUTH_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$DRIVER_AUTH_BODY" 2>&1 || true)

AUTH_CODE=$(echo "$AUTH_RESP" | tail -n1)
AUTH_BODY=$(echo "$AUTH_RESP" | sed '$d')

if [ "$AUTH_CODE" = "200" ]; then
  DRIVER_TOKEN=$(extract_json_field "$AUTH_BODY" "token")
  if [ -n "$DRIVER_TOKEN" ]; then
    echo "  [PASS] Driver token received (HTTP 200)"
  else
    echo "  [FAIL] HTTP 200 received but 'token' attribute was missing or empty"
    echo "  Response body: $AUTH_BODY"
    FAILURES=$((FAILURES + 1))
    DRIVER_TOKEN=""
  fi
else
  echo "  [FAIL] Expected HTTP 200 from POST /auth/token, got: $AUTH_CODE"
  echo "  Response body: $AUTH_BODY"
  FAILURES=$((FAILURES + 1))
  DRIVER_TOKEN=""
fi

# ------------------------------------------------------------------------------
# Test 2: POST /drivers/{id}/location with driver token
# ------------------------------------------------------------------------------
echo ""
echo "[Test 2/5] Updating driver location (POST /drivers/${DRIVER_ID}/location)..."
LOC_BODY='{"latitude":37.7749,"longitude":-122.4194}'

if [ -n "$DRIVER_TOKEN" ]; then
  LOC_RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/drivers/${DRIVER_ID}/location" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DRIVER_TOKEN}" \
    -d "$LOC_BODY" 2>&1 || true)

  LOC_CODE=$(echo "$LOC_RESP" | tail -n1)
  LOC_BODY_OUT=$(echo "$LOC_RESP" | sed '$d')

  if [ "$LOC_CODE" = "200" ]; then
    echo "  [PASS] Driver location updated successfully (HTTP 200)"
  else
    echo "  [FAIL] Expected HTTP 200 from POST /drivers/${DRIVER_ID}/location, got: $LOC_CODE"
    echo "  Response body: $LOC_BODY_OUT"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  [SKIP/FAIL] Skipped due to missing driver auth token"
  FAILURES=$((FAILURES + 1))
fi

# ------------------------------------------------------------------------------
# Test 3: POST /auth/token for test rider
# ------------------------------------------------------------------------------
echo ""
echo "[Test 3/5] Requesting test rider auth token..."
RIDER_ID="smoke-test-rider-$(date +%s)"
RIDER_AUTH_BODY="{\"subjectId\":\"${RIDER_ID}\",\"role\":\"rider\"}"

RIDER_AUTH_RESP=$(curl -s -w "\n%{http_code}" -X POST "${AUTH_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$RIDER_AUTH_BODY" 2>&1 || true)

RIDER_AUTH_CODE=$(echo "$RIDER_AUTH_RESP" | tail -n1)
RIDER_AUTH_BODY_OUT=$(echo "$RIDER_AUTH_RESP" | sed '$d')

if [ "$RIDER_AUTH_CODE" = "200" ]; then
  RIDER_TOKEN=$(extract_json_field "$RIDER_AUTH_BODY_OUT" "token")
  if [ -n "$RIDER_TOKEN" ]; then
    echo "  [PASS] Rider token received (HTTP 200)"
  else
    echo "  [FAIL] HTTP 200 received but 'token' attribute was missing or empty"
    echo "  Response body: $RIDER_AUTH_BODY_OUT"
    FAILURES=$((FAILURES + 1))
    RIDER_TOKEN=""
  fi
else
  echo "  [FAIL] Expected HTTP 200 from POST /auth/token, got: $RIDER_AUTH_CODE"
  echo "  Response body: $RIDER_AUTH_BODY_OUT"
  FAILURES=$((FAILURES + 1))
  RIDER_TOKEN=""
fi

# ------------------------------------------------------------------------------
# Test 4: POST /riders/{id}/rides to create a ride
# ------------------------------------------------------------------------------
echo ""
echo "[Test 4/5] Creating ride request (POST /riders/${RIDER_ID}/rides)..."
RIDE_REQ_BODY='{"pickupLocation":{"latitude":37.7749,"longitude":-122.4194},"dropoffLocation":{"latitude":37.7849,"longitude":-122.4094}}'
CREATED_RIDE_ID=""

if [ -n "$RIDER_TOKEN" ]; then
  RIDE_RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/riders/${RIDER_ID}/rides" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${RIDER_TOKEN}" \
    -d "$RIDE_REQ_BODY" 2>&1 || true)

  RIDE_CODE=$(echo "$RIDE_RESP" | tail -n1)
  RIDE_BODY_OUT=$(echo "$RIDE_RESP" | sed '$d')

  if [ "$RIDE_CODE" = "201" ]; then
    CREATED_RIDE_ID=$(extract_json_field "$RIDE_BODY_OUT" "rideId")
    if [ -n "$CREATED_RIDE_ID" ]; then
      echo "  [PASS] Ride created successfully (HTTP 201, rideId: ${CREATED_RIDE_ID})"
    else
      echo "  [FAIL] HTTP 201 received but 'rideId' attribute was missing in response"
      echo "  Response body: $RIDE_BODY_OUT"
      FAILURES=$((FAILURES + 1))
    fi
  else
    echo "  [FAIL] Expected HTTP 201 from POST /riders/${RIDER_ID}/rides, got: $RIDE_CODE"
    echo "  Response body: $RIDE_BODY_OUT"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  [SKIP/FAIL] Skipped due to missing rider auth token"
  FAILURES=$((FAILURES + 1))
fi

# ------------------------------------------------------------------------------
# Test 5: GET /rides/{id} and assert state == REQUESTED
# ------------------------------------------------------------------------------
echo ""
echo "[Test 5/5] Fetching created ride details (GET /rides/${CREATED_RIDE_ID:-<none>})..."

if [ -n "$CREATED_RIDE_ID" ] && [ -n "$RIDER_TOKEN" ]; then
  GET_RIDE_RESP=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}/rides/${CREATED_RIDE_ID}" \
    -H "Authorization: Bearer ${RIDER_TOKEN}" 2>&1 || true)

  GET_RIDE_CODE=$(echo "$GET_RIDE_RESP" | tail -n1)
  GET_RIDE_BODY_OUT=$(echo "$GET_RIDE_RESP" | sed '$d')

  if [ "$GET_RIDE_CODE" = "200" ]; then
    RIDE_STATE=$(extract_json_field "$GET_RIDE_BODY_OUT" "state")
    if [ "$RIDE_STATE" = "REQUESTED" ]; then
      echo "  [PASS] Ride details fetched (HTTP 200, state: REQUESTED)"
    else
      echo "  [FAIL] Expected ride state 'REQUESTED', got: '$RIDE_STATE'"
      echo "  Response body: $GET_RIDE_BODY_OUT"
      FAILURES=$((FAILURES + 1))
    fi
  else
    echo "  [FAIL] Expected HTTP 200 from GET /rides/${CREATED_RIDE_ID}, got: $GET_RIDE_CODE"
    echo "  Response body: $GET_RIDE_BODY_OUT"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  [SKIP/FAIL] Skipped due to missing rideId or rider auth token"
  FAILURES=$((FAILURES + 1))
fi

# ------------------------------------------------------------------------------
# Summary & Exit
# ------------------------------------------------------------------------------
echo ""
echo "======================================================================"
if [ "$FAILURES" -eq 0 ]; then
  echo "SMOKE TEST RESULT: PASS (All checks passed successfully)"
  echo "Target deployment at $BASE_URL is alive and responding correctly."
  echo "======================================================================"
  exit 0
else
  echo "SMOKE TEST RESULT: FAIL ($FAILURES check(s) failed)"
  echo "Target deployment at $BASE_URL may be broken or partially unavailable."
  echo "======================================================================"
  exit 1
fi
