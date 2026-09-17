#!/usr/bin/env bash
set -e

# Array of required directories relative to repo root
REQUIRED_DIRS=(
  "services/location-service"
  "services/matching-service"
  "services/trip-service"
  "services/notification-service"
  "shared/geospatial"
  "shared/matching-algorithms"
  "shared/models/go"
  "shared/models/ts"
  "shared/dynamo-client/go"
  "shared/dynamo-client/ts"
  "simulators/driver-simulator"
  "simulators/rider-simulator"
  "infra/modules/dynamodb"
  "infra/modules/lambda"
  "infra/modules/ec2-matching"
  "infra/modules/sqs-sns"
  "infra/modules/api-gateway"
  "docs/diagrams"
  "tests/unit"
  "tests/integration"
  "tests/load"
  ".github/workflows"
  "scripts"
)

FAILED=0

echo "Verifying project directory structure..."
for dir in "${REQUIRED_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    echo "  [PASS] $dir"
  else
    echo "  [FAIL] $dir (directory missing)"
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Structure verification FAILED."
  exit 1
fi

echo ""
echo "All required directories verified successfully."
exit 0
