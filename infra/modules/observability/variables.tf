# ==============================================================================
# Observability Module Variables
# ==============================================================================

variable "project_name" {
  description = "Project name prefix for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (e.g. local, dev, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for dashboard metric queries"
  type        = string
  default     = "us-east-1"
}

variable "ops_alert_email" {
  description = "Email address for operations alerts and DLQ depth alarm notifications"
  type        = string
}

variable "ride_request_dlq_arn" {
  description = "ARN of the ride-request events Dead Letter Queue"
  type        = string
}

variable "ride_request_dlq_name" {
  description = "Name of the ride-request events Dead Letter Queue"
  type        = string
}

variable "location_events_dlq_arn" {
  description = "ARN of the location events Dead Letter Queue"
  type        = string
}

variable "location_events_dlq_name" {
  description = "Name of the location events Dead Letter Queue"
  type        = string
}

variable "ride_request_queue_name" {
  description = "Name of the ride-request events primary SQS queue"
  type        = string
}

variable "location_events_queue_name" {
  description = "Name of the location events primary SQS queue"
  type        = string
}

variable "dynamodb_table_name" {
  description = "Name of the primary DynamoDB single table"
  type        = string
}

variable "lambda_function_names" {
  description = "List of all platform Lambda function names to monitor on the dashboard"
  type        = list(string)
}
