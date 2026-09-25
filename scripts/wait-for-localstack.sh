#!/usr/bin/env bash
set -e

ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
TIMEOUT=60
ELAPSED=0
INTERVAL=2

echo "Waiting for LocalStack services to be ready at ${ENDPOINT}..."

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  if docker exec ride-dispatch-localstack awslocal s3 ls > /dev/null 2>&1; then
    echo "LocalStack S3 is ready!"
    # Ensure DynamoDB, SQS, and SNS are also ready and responding
    if docker exec ride-dispatch-localstack awslocal dynamodb list-tables > /dev/null 2>&1 && \
       docker exec ride-dispatch-localstack awslocal sqs list-queues > /dev/null 2>&1 && \
       docker exec ride-dispatch-localstack awslocal sns list-topics > /dev/null 2>&1; then
      echo "LocalStack DynamoDB, SQS, and SNS are ready (after ${ELAPSED}s)."
      exit 0
    fi
  elif HEALTH_JSON=$(curl -s "${ENDPOINT}/_localstack/health" 2>/dev/null || true); then
    if echo "$HEALTH_JSON" | grep -qE '"dynamodb":\s*"(available|running)"'; then
      echo "LocalStack is healthy and DynamoDB is ready via HTTP (after ${ELAPSED}s)."
      exit 0
    fi
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  echo "  Waiting... (${ELAPSED}s / ${TIMEOUT}s elapsed)"
done

echo "ERROR: LocalStack failed to become ready within ${TIMEOUT} seconds."
exit 1
