# ==============================================================================
# Lambda Module Interface Variables
# ==============================================================================
# Interface contract for both Go (provided.al2023) and TypeScript (nodejs20.x)
# Lambdas. Parameterized to support all compute workloads across the platform.
# ==============================================================================

variable "runtime" {
  description = "Lambda execution runtime ('nodejs20.x' or 'provided.al2023')"
  type        = string

  validation {
    condition     = contains(["nodejs20.x", "provided.al2023"], var.runtime)
    error_message = "The runtime variable must be either 'nodejs20.x' or 'provided.al2023'."
  }
}

variable "handler" {
  description = "Lambda function handler ('bootstrap' for Go provided.al2023, or exported function for Node.js e.g. 'index.handler')"
  type        = string
}

variable "artifact_path" {
  description = "Path to the .zip deployment package"
  type        = string
}

variable "function_name" {
  description = "Unique name for the Lambda function"
  type        = string
}

variable "environment_variables" {
  description = "Map of environment variables to configure in the Lambda environment"
  type        = map(string)
  default     = {}
}

variable "dynamodb_table_arn" {
  description = "Optional DynamoDB table ARN for IAM access policy (grants GetItem, PutItem, Query on table and indexes)"
  type        = string
  default     = null
}

variable "timeout" {
  description = "Execution timeout for the Lambda function in seconds"
  type        = number
  default     = 10
}

variable "memory_size" {
  description = "Allocated memory size for the Lambda function in MB"
  type        = number
  default     = 128
}
