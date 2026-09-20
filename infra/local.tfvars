# ==============================================================================
# Local Environment Configuration (LocalStack)
# ==============================================================================
# Environment-specific variable values for local emulation via LocalStack.
#
# Usage:
#   terraform plan -var-file=local.tfvars
#   terraform apply -var-file=local.tfvars
# ==============================================================================

environment      = "local"
internal_api_key = "dev-internal-api-key-for-matching-service"

