# ==============================================================================
# Terraform Remote State Backend
# ==============================================================================
# NOTE: S3 bucket creation is a one-time manual prerequisite before running
# `terraform init` against real AWS infrastructure:
#
#   aws s3 mb s3://<YOUR_TF_STATE_BUCKET_NAME> --region us-east-1
#   aws s3api put-bucket-versioning \
#     --bucket <YOUR_TF_STATE_BUCKET_NAME> \
#     --versioning-configuration Status=Enabled
#
# For local emulation with LocalStack, or when validating syntax offline,
# use `terraform init -backend=false`.
# ==============================================================================

terraform {
  backend "s3" {
    bucket = "YOUR_TF_STATE_BUCKET_NAME_PLACEHOLDER"
    key    = "ride-dispatch-platform/terraform.tfstate"
    region = "us-east-1"
  }
}
