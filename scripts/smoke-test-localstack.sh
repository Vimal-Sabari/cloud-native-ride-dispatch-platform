#!/usr/bin/env bash
set -e

export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"
export AWS_DEFAULT_REGION="us-east-1"
ENDPOINT_URL="${AWS_ENDPOINT:-http://localhost:4566}"
TABLE_NAME="smoke-test-table"

echo "=== LocalStack Smoke Test ==="
echo "Endpoint: $ENDPOINT_URL"
echo "Region:   $AWS_DEFAULT_REGION"

echo "1. Creating DynamoDB table '$TABLE_NAME'..."
aws --endpoint-url="$ENDPOINT_URL" dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST > /dev/null

echo "2. Waiting for table '$TABLE_NAME' to reach ACTIVE status..."
aws --endpoint-url="$ENDPOINT_URL" dynamodb wait table-exists \
  --table-name "$TABLE_NAME"

echo "3. Verifying table in list-tables..."
TABLE_LIST=$(aws --endpoint-url="$ENDPOINT_URL" dynamodb list-tables --output text)

if echo "$TABLE_LIST" | grep -q "$TABLE_NAME"; then
  echo "  [PASS] Table '$TABLE_NAME' exists and is queryable."
else
  echo "  [FAIL] Table '$TABLE_NAME' was not found in list-tables."
  exit 1
fi

echo "4. Deleting table '$TABLE_NAME'..."
aws --endpoint-url="$ENDPOINT_URL" dynamodb delete-table \
  --table-name "$TABLE_NAME" > /dev/null

echo "LocalStack smoke test completed successfully!"
exit 0
