# ==============================================================================
# AWS Development Environment Configuration (aws-dev)
# ==============================================================================
# Environment-specific variable values for the real AWS development deployment.
#
# Usage:
#   terraform plan -var-file=aws-dev.tfvars
#   terraform apply -var-file=aws-dev.tfvars
# ==============================================================================

environment      = "aws-dev"
internal_api_key = "placeholder-aws-dev-internal-api-key"

