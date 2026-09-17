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
