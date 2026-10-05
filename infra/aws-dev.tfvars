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

# IMPORTANT: Replace this placeholder with a verified operator email address
# before deploying to real AWS. AWS SNS will send a subscription confirmation
# email that must be clicked once before alerts can be delivered.
ops_alert_email = "operator-alert@example.com"


