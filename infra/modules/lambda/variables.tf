# ==============================================================================
# Lambda Module Interface Variables
# ==============================================================================
# Interface contract for both Go (provided.al2023) and TypeScript (nodejs20.x)
# Lambdas. Defaults are set to null so callers are not required to pass them
# during early skeleton phases before real resources are wired.
# ==============================================================================

variable "runtime" {
  description = "Lambda execution runtime ('nodejs20.x' or 'provided.al2023')"
  type        = string
  default     = null

  validation {
    condition     = var.runtime == null || contains(["nodejs20.x", "provided.al2023"], var.runtime)
    error_message = "The runtime variable must be either 'nodejs20.x' or 'provided.al2023'."
  }
}

variable "handler" {
  description = "Lambda function handler ('bootstrap' for Go provided.al2023, or exported function for Node.js)"
  type        = string
  default     = null
}

variable "artifact_path" {
  description = "Path to the .zip deployment package"
  type        = string
  default     = null
}

variable "function_name" {
  description = "Unique name for the Lambda function"
  type        = string
  default     = null
}

variable "environment_variables" {
  description = "Map of environment variables to configure in the Lambda environment"
  type        = map(string)
  default     = {}
}
