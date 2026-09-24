variable "environment" {
  description = "Target deployment environment (e.g., local, aws-dev)"
  type        = string
}

variable "project_name" {
  description = "Project name identifier used for resource naming"
  type        = string
}
