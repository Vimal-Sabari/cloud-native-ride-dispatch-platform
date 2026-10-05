# Infrastructure Setup & Terraform Guide

This document covers Terraform Infrastructure-as-Code (IaC) setup, state management, execution workflows, and polyglot Lambda packaging conventions for the **Cloud-Native Ride Dispatch & Matching Platform**.

---

## 1. Prerequisites

- **Terraform** >= 1.7
- **AWS CLI** v2 configured with appropriate credentials (or LocalStack for local emulation)
- **Go** 1.23+ and **Node.js** 20.x for compiling/packaging service artifacts

---

## 2. Remote State Management (S3 Backend)

Terraform remote state is stored in an Amazon S3 bucket with versioning enabled. S3 bucket creation is a one-time manual prerequisite before running `terraform init` against real AWS infrastructure.

### One-Time State Bucket Creation

Run the following commands using the AWS CLI (replace `<YOUR_TF_STATE_BUCKET_NAME>` with your unique bucket name, e.g., `ride-dispatch-platform-tfstate-dev`):

```bash
# 1. Create the S3 bucket
aws s3 mb s3://<YOUR_TF_STATE_BUCKET_NAME> --region us-east-1

# 2. Enable bucket versioning to preserve state history and recovery
aws s3api put-bucket-versioning \
  --bucket <YOUR_TF_STATE_BUCKET_NAME> \
  --versioning-configuration Status=Enabled

# 3. Block public access (security best practice)
aws s3api put-public-access-block \
  --bucket <YOUR_TF_STATE_BUCKET_NAME> \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

Once created, update the `bucket` attribute in [`infra/backend.tf`](../infra/backend.tf):

```hcl
terraform {
  backend "s3" {
    bucket = "your-actual-state-bucket-name"
    key    = "ride-dispatch-platform/terraform.tfstate"
    region = "us-east-1"
  }
}
```

> **Note on Local/Offline Validation:**  
> When working locally without remote AWS credentials or when verifying configuration syntax, initialize Terraform with backend initialization disabled:
> ```bash
> terraform init -backend=false
> ```

---

## 3. Terraform CLI Commands

All Terraform commands can be executed either directly from the `infra/` directory or via the root `Makefile` targets.

### Direct Execution from `infra/`

```bash
cd infra

# Initialize Terraform providers and child modules (offline/local backend)
terraform init -backend=false

# Check and format code recursively
terraform fmt -recursive

# Validate HCL syntax and configuration
terraform validate

# Plan deployment against LocalStack
terraform plan -var-file=local.tfvars

# Plan deployment against AWS development
terraform plan -var-file=aws-dev.tfvars
```

### Makefile Convenience Targets

From the repository root, use the convenience targets:

```bash
make tf-fmt       # Format all Terraform files recursively
make tf-validate  # Validate configuration syntax and consistency
make tf-init      # Initialize child modules and providers (-backend=false)
make tf-plan      # Run terraform plan using local.tfvars
```

---

## 4. Environment Conventions (`local` vs. `aws-dev`)

The platform supports two target environments, configured via environment-specific `.tfvars` files:

1. **`local.tfvars` (`environment = "local"`):**
   - Targets LocalStack emulation on `http://localhost:4566`.
   - Used during local development and offline integration testing.
   - Requires no real AWS billing or remote state bucket.

2. **`aws-dev.tfvars` (`environment = "aws-dev"`):**
   - Targets the actual AWS development environment in `us-east-1`.
   - Uses real AWS resources (DynamoDB, SQS/SNS, API Gateway, EC2, Lambda).
   - Utilizes the S3 remote backend defined in `infra/backend.tf`.

---

## 5. Polyglot Lambda Packaging

The platform includes microservices written in both **Go** and **TypeScript**. Both runtime types are provisioned using the **single, reusable [`infra/modules/lambda`](../infra/modules/lambda/) module**, parameterized via input variables:

- `runtime`
- `handler`
- `artifact_path`
- `function_name`
- `environment_variables`

### Go Lambdas (Location Service)

AWS Lambda running Go code on the `provided.al2023` Amazon Linux custom runtime requires an executable binary named exactly `bootstrap`:

```bash
# 1. Compile the Go binary for Linux AMD64
cd services/location-service
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bootstrap .

# 2. Package into a deployment zip
zip -j location-service.zip bootstrap
```

Terraform invocation parameters:
- `runtime`: `"provided.al2023"`
- `handler`: `"bootstrap"`
- `artifact_path`: `"path/to/location-service.zip"`

### TypeScript Lambdas (Trip Service & Notification Service)

TypeScript Lambdas execute on the native `nodejs20.x` runtime:

```bash
# 1. Bundle TypeScript source using esbuild or tsc into a dist/ directory
npm run build --workspace=services/trip-service

# 2. Package dist contents into a deployment zip
cd services/trip-service/dist && zip -r ../trip-service.zip .
```

Terraform invocation parameters:
- `runtime`: `"nodejs20.x"`
- `handler`: `"index.handler"`
- `artifact_path`: `"path/to/trip-service.zip"`

### Shared Module Interface Contract

Both languages route through the same module declaration in `infra/modules/lambda/variables.tf`. This unified interface prevents configuration divergence while honoring each language's build and runtime requirements.

---

## 6. Deploying Location Service Locally

To deploy and test the Location Service with real infrastructure against LocalStack (including DynamoDB single-table schema, Go Lambdas, API Gateway REST API, and custom JWT authorizer):

### Step 1: Start LocalStack

Ensure Docker is running, then launch the LocalStack container:

```bash
docker compose up -d
bash scripts/wait-for-localstack.sh
```

### Step 2: Build Lambda Deployment Artifacts

Build the Go binaries for the Location Service endpoints and bundle the TypeScript JWT authorizer:

```bash
# 1. Build Location Service Go Lambdas (provided.al2023)
bash scripts/build-go-lambda.sh services/location-service update-location
bash scripts/build-go-lambda.sh services/location-service update-status

# 2. Bundle JWT Authorizer Node.js Lambda (nodejs20.x)
bash scripts/build-node-lambda.sh services/auth-stub authorizer
```

### Step 3: Deploy Infrastructure via Terraform

Provision the local infrastructure using LocalStack overrides:

```bash
cd infra
terraform init -backend=false
terraform apply -var-file=local.tfvars -auto-approve
cd ..
```

### Step 4: Run End-to-End Integration Tests

Execute the automated test suite to verify authorized location updates, status transitions, unauthorized rejection, and DynamoDB single-table GSI1 consistency:

```bash
bash tests/integration/location-service-test.sh
```

### Step 5: Teardown Infrastructure

When finished testing, destroy the provisioned LocalStack resources:

```bash
cd infra
terraform destroy -var-file=local.tfvars -auto-approve
cd ..
```

---

## 7. Deploying Trip Service Locally

To deploy and test Trip Service with real infrastructure against LocalStack (including DynamoDB single-table schema, five TypeScript Lambdas, unified API Gateway REST API, custom JWT authorizer, and handler-level internal API key validation):

### Step 1: Start LocalStack

Ensure Docker is running, then launch the LocalStack container:

```bash
docker compose up -d
bash scripts/wait-for-localstack.sh
```

### Step 2: Build Lambda Deployment Artifacts

Bundle the five Trip Service TypeScript handlers and the JWT authorizer into standalone deployment zip packages using the reusable build script:

```bash
# 1. Bundle JWT Authorizer (nodejs20.x)
bash scripts/build-node-lambda.sh services/auth-stub src/authorizer.ts authorizer

# 2. Bundle Trip Service Handlers (nodejs20.x)
bash scripts/build-node-lambda.sh services/trip-service src/handlers/request-ride-entry.ts request-ride
bash scripts/build-node-lambda.sh services/trip-service src/handlers/get-ride-entry.ts get-ride
bash scripts/build-node-lambda.sh services/trip-service src/handlers/cancel-ride-entry.ts cancel-ride
bash scripts/build-node-lambda.sh services/trip-service src/handlers/list-rider-rides-entry.ts list-rider-rides
bash scripts/build-node-lambda.sh services/trip-service src/handlers/internal-assign-driver-entry.ts assign-driver
```

### Step 3: Deploy Infrastructure via Terraform

Provision the local infrastructure (DynamoDB table, compute Lambdas, unified API Gateway with all Location and Trip Service routes):

```bash
cd infra
terraform init -backend=false
terraform apply -var-file=local.tfvars -auto-approve
cd ..
```

### Step 4: Run End-to-End Integration Tests

Execute the automated test suite to verify the full ride lifecycle:
- Request ride (`POST /riders/{id}/rides`) -> 201 Created
- Get ride details (`GET /rides/{id}`) -> 200 OK (`REQUESTED` state)
- List rider rides (`GET /riders/{id}/rides`) -> 200 OK (includes created ride)
- Cancel ride (`POST /rides/{id}/cancel`) -> 200 OK (`CANCELLED` state)
- Repeated cancellation rejection -> 409 Conflict
- Internal driver assignment (`POST /internal/rides/{id}/assign-driver` with `x-internal-api-key`) -> 200 OK (`MATCHED` state)
- Handler-level auth enforcement on internal route with invalid or missing API key -> 401 Unauthorized

```bash
bash tests/integration/trip-service-test.sh
```

### Step 5: Teardown Infrastructure

When finished testing, destroy the provisioned LocalStack resources:

```bash
cd infra
terraform destroy -var-file=local.tfvars -auto-approve
cd ..
```

---

## 7. Observability Dashboard & Alerting

Module 26 provisions a centralized CloudWatch dashboard (`<project_name>-<environment>-platform-overview`) and DLQ-depth metric alarms backed by an SNS alerting topic.

### Opening the Dashboard in AWS Management Console

To view the dashboard in the AWS Management Console:
1. Sign in to the AWS Management Console and select your deployment region (e.g., `us-east-1`).
2. Navigate to CloudWatch Dashboards or use the direct URL pattern:
   ```
   https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#dashboards/dashboard/<project_name>-<environment>-platform-overview
   ```
   For example, for the `aws-dev` deployment in `us-east-1`:
   ```
   https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/ride-dispatch-platform-aws-dev-platform-overview
   ```

### One-Time Email Subscription Confirmation

The SNS topic subscription (`aws_sns_topic_subscription.ops_alerts_email`) uses the `email` protocol.
- When Terraform applies against real AWS, AWS SNS automatically sends a "Subscription Confirmation" email to `var.ops_alert_email`.
- An operator must open this email and click **Confirm subscription** before any operational alarms can be delivered. Until confirmed, the subscription remains in `PendingConfirmation` state.

### Verification Limitations on LocalStack

> [!IMPORTANT]
> **LocalStack Verification Limitations:**
> LocalStack's Community CloudWatch implementation supports resource definitions (storing and returning dashboard JSON, creating alarm entities) but does not evaluate metric math, transition alarms to `ALARM` state, or send outbound emails.
> The automated integration test (`tests/integration/observability-infra-test.sh`) validates resource DEFINITION correctness only (verifying the dashboard JSON widget structure and alarm threshold properties). Functional alarm evaluation and end-to-end email delivery must be verified against real AWS.

### Manual Verification Procedure against Real AWS (Module 29 and beyond)

Once deployed to real AWS (`aws-dev`), operators can verify the complete alarm and email notification pipeline by injecting a test message directly into a DLQ:

1. **Verify Alarm Initial State:**
   Confirm the alarm is in `OK` state:
   ```bash
   aws cloudwatch describe-alarms \
     --alarm-names "ride-dispatch-platform-aws-dev-ride-request-dlq-depth" \
     --region us-east-1 \
     --query "MetricAlarms[0].StateValue"
   ```

2. **Directly Send a Message to the DLQ:**
   Bypass the standard processing pipeline and publish directly to the Dead Letter Queue:
   ```bash
   DLQ_URL=$(aws sqs get-queue-url \
     --queue-name "ride-dispatch-platform-aws-dev-ride-request-events-dlq" \
     --region us-east-1 \
     --output text)

   aws sqs send-message \
     --queue-url "$DLQ_URL" \
     --message-body '{"test": "manual-alarm-verification-message"}' \
     --region us-east-1
   ```

3. **Observe Alarm Transition and Email Alert:**
   - Within 60 seconds (the alarm evaluation period), CloudWatch detects `ApproximateNumberOfMessagesVisible >= 1`.
   - The alarm transitions to `ALARM` state.
   - An email notification containing alarm details is delivered to `ops_alert_email`.

4. **Purge the DLQ:**
   After confirming notification delivery, purge the test message from the DLQ to return the alarm to `OK`:
   ```bash
   aws sqs purge-queue --queue-url "$DLQ_URL" --region us-east-1
   ```



