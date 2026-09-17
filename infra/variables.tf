variable "aws_region" {
  description = "AWS region for infrastructure deployment"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Target deployment environment (local or aws-dev)"
  type        = string

  validation {
    condition     = contains(["local", "aws-dev"], var.environment)
    error_message = "Environment must be either 'local' or 'aws-dev'."
  }
}

variable "project_name" {
  description = "Project name identifier used for tagging and resource naming"
  type        = string
  default     = "ride-dispatch-platform"
}
