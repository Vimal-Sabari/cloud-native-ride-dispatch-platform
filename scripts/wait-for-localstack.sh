#!/usr/bin/env bash
set -e

ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
TIMEOUT=60
ELAPSED=0
INTERVAL=2

echo "Waiting for LocalStack services to be ready at ${ENDPOINT}..."

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  HEALTH_JSON=$(curl -s "${ENDPOINT}/_localstack/health" 2>/dev/null || true)
  if echo "$HEALTH_JSON" | grep -q '"services"'; then
    echo "LocalStack health endpoint is reporting services..."
    # Verify DynamoDB responds via AWS CLI or docker exec
    if aws dynamodb list-tables --endpoint-url="${ENDPOINT}" --region us-east-1 > /dev/null 2>&1 || \
       docker exec ride-dispatch-localstack awslocal dynamodb list-tables > /dev/null 2>&1; then
      echo "LocalStack DynamoDB is accessible and ready (after ${ELAPSED}s)."
      sleep 2
      exit 0
    fi
  elif docker exec ride-dispatch-localstack awslocal s3 ls > /dev/null 2>&1; then
    echo "LocalStack S3 is ready!"
    if docker exec ride-dispatch-localstack awslocal dynamodb list-tables > /dev/null 2>&1; then
      echo "LocalStack DynamoDB is ready via docker exec (after ${ELAPSED}s)."
      sleep 2
      exit 0
    fi
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  echo "  Waiting... (${ELAPSED}s / ${TIMEOUT}s elapsed)"
done

echo "ERROR: LocalStack failed to become ready within ${TIMEOUT} seconds."
exit 1
