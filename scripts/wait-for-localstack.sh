#!/usr/bin/env bash
set -e

ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
TIMEOUT=60
ELAPSED=0
INTERVAL=2

echo "Waiting for LocalStack DynamoDB service to be ready at ${ENDPOINT}..."

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  HEALTH_JSON=$(curl -s "${ENDPOINT}/_localstack/health" 2>/dev/null || true)
  if echo "$HEALTH_JSON" | grep -qE '"dynamodb":\s*"(available|running)"'; then
    echo "LocalStack is healthy and DynamoDB is ready (after ${ELAPSED}s)."
    exit 0
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  echo "  Waiting... (${ELAPSED}s / ${TIMEOUT}s elapsed)"
done

echo "ERROR: LocalStack failed to become ready within ${TIMEOUT} seconds."
echo "Last response from ${ENDPOINT}/_localstack/health:"
echo "$HEALTH_JSON"
exit 1
