variable "environment" {
  description = "Target deployment environment (local or aws-dev)"
  type        = string
}

variable "project_name" {
  description = "Project name identifier used for tagging and resource naming"
  type        = string
  default     = "ride-dispatch-platform"
}

variable "dynamodb_table_arn" {
  description = "ARN of the single DynamoDB table"
  type        = string
}

variable "location_events_queue_arn" {
  description = "ARN of the SQS location-events queue"
  type        = string
}

variable "ride_request_events_queue_arn" {
  description = "ARN of the SQS ride-request-events queue"
  type        = string
}

variable "ami_id" {
  description = "Optional AMI ID for Matching Service EC2 instance; if empty, latest Amazon Linux 2023 AMI is queried"
  type        = string
  default     = ""
}
