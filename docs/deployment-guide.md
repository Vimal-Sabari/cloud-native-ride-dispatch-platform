# AWS Deployment Pipeline Guide (`deploy.yml`)

This guide provides an end-to-end operational manual for deploying the **Cloud-Native Ride Dispatch & Matching Platform** to a real AWS development environment (`aws-dev`).

The deployment pipeline is automated via GitHub Actions in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). It orchestrates the platform's polyglot build scripts, provisions cloud infrastructure via Terraform, deploys the Matching Service Go daemon to EC2, and runs automated smoke tests against live API Gateway endpoints—all gated behind an explicit human review approval step.

---

## 1. Overview & Pipeline Philosophy

Unlike continuous integration ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)), which runs automated unit tests and LocalStack integration tests on every commit and pull request, the deployment pipeline adheres to the following core operational principles:

1. **Manual Dispatch Only (`workflow_dispatch`):** The workflow is never triggered automatically on push. Real AWS infrastructure is only modified by an intentional human decision.
2. **Environment Protection Gate (`aws-dev-production`):** After services are compiled and packaged, the pipeline pauses execution until a designated reviewer explicitly approves the deployment in the GitHub UI.
3. **Passwordless AWS OIDC Federation:** The pipeline assumes temporary IAM credentials via OpenID Connect (OIDC), eliminating static, long-lived AWS secret access keys.
4. **Artifact-Driven Immutability:** Binaries and Lambda zip packages built during the `build` job are passed as immutable artifacts to downstream jobs, guaranteeing identical binaries across deployment steps.

```mermaid
flowchart TD
    Trigger["1. workflow_dispatch<br/>(Manual Trigger)"] --> Build["2. Job: build<br/>(Compile Go & Node Lambdas + EC2 Binary)"]
    Build --> Artifacts["Upload Artifacts<br/>(zips + binary)"]
    Artifacts --> Await["3. Job: await-approval<br/>(Environment: aws-dev-production)"]
    Await -.->|"Human Reviewer Signs Off"| TF["4. Job: terraform-apply<br/>(OIDC Auth + terraform apply -auto-approve)"]
    TF --> Outputs["Upload tf-outputs.json"]
    Outputs --> DeployEC2["5. Job: deploy-matching-service<br/>(SCP & systemd restart on EC2)"]
    DeployEC2 --> Smoke["6. Job: smoke-test<br/>(Lightweight live API Gateway validation)"]
```

---

## 2. One-Time Setup Prerequisites

Before running the deployment workflow for the first time, complete these one-time administrative setups:

### 2.1 Remote State S3 Bucket
Terraform uses an Amazon S3 backend to track infrastructure state across workflow runs. As documented in [Infrastructure Setup Guide](infrastructure-setup.md#2-remote-state-management-s3-backend), create the bucket once using the AWS CLI:

```bash
# Set your chosen globally unique bucket name
export STATE_BUCKET="ride-dispatch-platform-tfstate-$(aws sts get-caller-identity --query Account --output text)"

# 1. Create S3 bucket in us-east-1
aws s3 mb "s3://${STATE_BUCKET}" --region us-east-1

# 2. Enable versioning to protect against accidental state corruption
aws s3api put-bucket-versioning \
  --bucket "${STATE_BUCKET}" \
  --versioning-configuration Status=Enabled

# 3. Block public access
aws s3api put-public-access-block \
  --bucket "${STATE_BUCKET}" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

Update [`infra/backend.tf`](../infra/backend.tf) with your bucket name:
```hcl
terraform {
  backend "s3" {
    bucket = "your-actual-state-bucket-name"
    key    = "ride-dispatch-platform/terraform.tfstate"
    region = "us-east-1"
  }
}
```

---

### 2.2 GitHub Environment (`aws-dev-production`)

GitHub Actions protection rules require a GitHub Environment configured in repository settings.

> [!IMPORTANT]
> This configuration **cannot** be declared inside the workflow YAML file. GitHub requires this to be configured via the repository administrative UI.

1. Navigate to your GitHub repository in a browser.
2. Click **Settings** > **Environments** (in the left sidebar).
3. Click **New environment**.
4. Enter the exact environment name: `aws-dev-production` and click **Configure environment**.
5. Under **Environment protection rules**:
   - Check the **Required reviewers** box.
   - Search for and select your GitHub username (or designated deployment leads).
   - Leave "Prevent self-review" unchecked if you are a solo maintainer.
6. Click **Save protection rules**.

---

### 2.3 AWS IAM OpenID Connect (OIDC) Identity Provider & Role

GitHub Actions authenticates to AWS securely via temporary web identity tokens.

#### Step 1: Create IAM OIDC Identity Provider (if not already present)
In the AWS IAM Console (or CLI):
- **Provider Type:** OpenID Connect
- **Provider URL:** `https://token.actions.githubusercontent.com`
- **Audience:** `sts.amazonaws.com`

Using AWS CLI:
```bash
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1"
```

#### Step 2: Create IAM Role with Trust Policy
Create an IAM Role named `GitHubActionsRideDispatchDeployRole` with the following trust policy scoped to this repository. Refer to official [AWS IAM documentation on GitHub OIDC](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html) for details:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<YOUR_AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:Vimal-Sabari/cloud-native-ride-dispatch-platform:*"
        }
      }
    }
  ]
}
```

> [!TIP]
> To restrict the role exclusively to the approved environment, change the condition to:
> `"token.actions.githubusercontent.com:sub": "repo:Vimal-Sabari/cloud-native-ride-dispatch-platform:environment:aws-dev-production"`

Attach the required permissions to the role for managing the platform's resources (`AdministratorAccess` or a tailored policy granting rights to DynamoDB, SQS, SNS, Lambda, API Gateway, EC2, IAM, and CloudWatch).

---

### 2.4 GitHub Repository Secrets & Variables

In your repository (**Settings** > **Secrets and variables** > **Actions**):

| Type | Name | Purpose | Example |
| :--- | :--- | :--- | :--- |
| **Secret or Variable** | `AWS_ROLE_ARN` | IAM Role ARN configured in step 2.3 | `arn:aws:iam::123456789012:role/GitHubActionsRideDispatchDeployRole` |
| **Variable** | `AWS_REGION` | Target deployment region (optional, defaults to `us-east-1`) | `us-east-1` |
| **Secret** | `EC2_SSH_KEY` | Private SSH key (`.pem`) matching the EC2 key pair for Matching Service SSH deployments | `-----BEGIN RSA PRIVATE KEY-----...` |

---

### 2.5 Configuring `infra/aws-dev.tfvars`

Ensure [`infra/aws-dev.tfvars`](../infra/aws-dev.tfvars) is populated with your environment variables:

```hcl
environment      = "aws-dev"
internal_api_key = "replace-with-secure-internal-service-secret"

# Required for Module 26 CloudWatch alarms (SNS email subscription)
ops_alert_email  = "your-real-email@example.com"
```

> [!NOTE]
> - `ops_alert_email`: AWS SNS will send a subscription confirmation email to this address on initial creation. You must click the confirmation link in the email once to receive DLQ alarms.
> - `DRIVER_ACCEPT_TIMEOUT_SECONDS`: Hardcoded to `60` seconds in [`infra/main.tf`](../infra/main.tf) for the stale-match reassignment worker.

---

## 3. How to Trigger a Deployment

1. Go to your GitHub repository and click the **Actions** tab.
2. In the left workflow list, select **Deploy**.
3. Click the **Run workflow** dropdown button on the right.
4. Select the branch to deploy (typically `main`) and click **Run workflow**.
5. Once the `build` job completes, the workflow run will show a yellow waiting badge on the `await-approval` job with the prompt:
   > *"aws-dev-production waiting for review"*
6. Click **Review deployments**, check the **aws-dev-production** environment box, and click **Approve and deploy**.
7. Downstream jobs (`terraform-apply`, `deploy-matching-service`, and `smoke-test`) will proceed automatically.

---

## 4. Pipeline Jobs Walkthrough

### 1. `build`
- Checks out the repository and sets up Go 1.23 and Node.js 20 with package caches.
- Compiles shared TypeScript packages (`models`, `dynamo-client`, `auth`, `sns-client`, `logging`).
- Executes build scripts:
  - [`scripts/build-go-lambda.sh`](../scripts/build-go-lambda.sh) for Location Service Lambdas (`update-location`, `update-status`) and DynamoDB Streams `event-forwarder`.
  - [`scripts/build-go-binary.sh`](../scripts/build-go-binary.sh) for Matching Service EC2 binary (`bin/matching-service`).
  - [`scripts/build-node-lambda.sh`](../scripts/build-node-lambda.sh) for Auth Stub (`authorizer`), Trip Service (`request-ride`, `get-ride`, `cancel-ride`, `list-rider-rides`, `assign-driver`, `reassign-stale-matches`), and Notification Service (`connect`, `disconnect`, `fanout`).
- Uploads all zips and binaries as a single `build-artifacts` workflow artifact.

### 2. `await-approval`
- Targets `environment: aws-dev-production`.
- Halts pipeline until an authorized reviewer approves.
- Runs a lightweight confirmation step once unblocked.

### 3. `terraform-apply`
- Downloads `build-artifacts` to restore Lambda zips.
- Authenticates to AWS via `aws-actions/configure-aws-credentials@v4` using OIDC.
- Runs `cd infra && terraform init && terraform apply -var-file=aws-dev.tfvars -auto-approve`.
  - `-auto-approve` is deliberate and safe here because human review already occurred at the `await-approval` gate.
- Exports Terraform output values to `tf-outputs.json` (`terraform output -json > tf-outputs.json`) and uploads it as an artifact.

### 4. `deploy-matching-service`
- Downloads `build-artifacts` (`bin/matching-service`) and `tf-outputs.json`.
- Runs [`scripts/deploy-matching-service.sh tf-outputs.json`](../scripts/deploy-matching-service.sh).
- Extracts the EC2 public IP from `tf-outputs.json`, copies the binary and `matching-service.service` via SCP, and restarts the systemd daemon over SSH.

### 5. `smoke-test`
- Downloads `tf-outputs.json` to resolve `api_gateway_invoke_url`.
- Runs [`scripts/smoke-test-deployed.sh <api-gateway-url>`](../scripts/smoke-test-deployed.sh):
  1. Driver auth token via `POST /auth/token` (HTTP 200).
  2. Driver GPS update via `POST /drivers/{id}/location` (HTTP 200).
  3. Rider auth token via `POST /auth/token` (HTTP 200).
  4. Ride creation via `POST /riders/{id}/rides` (HTTP 201).
  5. Ride verification via `GET /rides/{id}` (HTTP 200, state `REQUESTED`).
- Fails the workflow if any endpoint returns unexpected status codes.

---

## 5. Rollback Procedures

Given the project's scale as a demonstration and portfolio platform, complex blue/green deployments or Canary routing (e.g. AWS Route 53 weighted records or API Gateway canary stages) add disproportionate complexity and ongoing cost.

### How to Roll Back:
To revert an unhealthy deployment:
1. Identify the previous known-good commit hash or tag in Git history.
2. In GitHub Actions, navigate to **Deploy** > **Run workflow**.
3. Under **Use workflow from**, enter the Git ref or commit SHA of the known-good version.
4. Click **Run workflow** and approve the deployment.
5. Terraform will re-apply the previous infrastructure state, and the previous application binaries will be deployed.

---

## 6. Infrastructure Teardown (`scripts/teardown-aws-dev.sh`)

To eliminate cloud charges when the platform is not actively in use for demonstrations or evaluation, tear down the environment:

```bash
bash scripts/teardown-aws-dev.sh
```

> [!CAUTION]
> This command runs `terraform destroy -var-file=aws-dev.tfvars -auto-approve`, completely removing all DynamoDB data, EC2 instances, API Gateways, queues, and CloudWatch metrics in the `aws-dev` environment.

---

## 7. Cost & AWS Free Tier Analysis

The architecture has been deliberately engineered to minimize operational expenses. Below is an itemized breakdown of expected AWS resource consumption:

| AWS Service | Free Tier Monthly Allowance | Project Usage Profile | Cost Expectation |
| :--- | :--- | :--- | :--- |
| **AWS Lambda** | 1,000,000 requests / month + 3.2M sec compute | Polyglot Lambdas run on 128 MB RAM, sub-100ms runtimes | **$0.00** (Strictly within Free Tier) |
| **Amazon DynamoDB** | 25 GB storage + 25 WCU / 25 RCU | Single-table design, on-demand pay-per-request | **$0.00** (Within Free Tier limits) |
| **Amazon SQS & SNS** | 1,000,000 SQS requests + 1,000,000 SNS publishes | Low-volume event routing for demo traffic | **$0.00** (Strictly within Free Tier) |
| **Amazon API Gateway** | 1,000,000 REST API calls / month (12 months free) | Demonstrations and smoke tests | **$0.00** (Within Free Tier) |
| **Amazon CloudWatch** | 10 custom metrics, 3 dashboards, 10 alarms | 4 EMF metrics, 1 dashboard, 2 DLQ alarms | **$0.00** (Within Free Tier) |
| **Amazon EC2** (`t2.micro`) | 750 hours / month (12 months free) | Single instance running Matching Service | **$0.00** if within 750 hrs/month (see note below) |

### Important Cost Notes:
- **EC2 Running Hours:** A single continuously-running `t2.micro` instance consumes 720–744 hours per month, fitting just inside the 750-hour free allowance. However, if multiple instances or overlapping test runs occur, or if your AWS account has expired its 12-month Free Tier period, an active `t2.micro` costs ~$0.0116/hour (~$8.50/month). **Always run `scripts/teardown-aws-dev.sh` between sessions.**
- **Load Testing (Module 28):** Executing high-concurrency load testing (e.g. k6 driver bursts with 100+ virtual users) against the real AWS deployment generates thousands of API requests and inter-service data transfer. Keep sustained load runs short (<5 minutes) when pointing to live AWS to avoid egress charges.
