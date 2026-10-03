variable "project_name" {
  type        = string
  description = "Name of the project"
  default     = "ride-dispatch"
}

variable "environment" {
  type        = string
  description = "Deployment environment (e.g., local, dev, prod)"
  default     = "local"
}

variable "connect_lambda_invoke_arn" {
  type        = string
  description = "Invoke ARN of the Notification Service WebSocket $connect Lambda"
}

variable "connect_lambda_function_name" {
  type        = string
  description = "Function name of the Notification Service WebSocket $connect Lambda"
}

variable "disconnect_lambda_invoke_arn" {
  type        = string
  description = "Invoke ARN of the Notification Service WebSocket $disconnect Lambda"
}

variable "disconnect_lambda_function_name" {
  type        = string
  description = "Function name of the Notification Service WebSocket $disconnect Lambda"
}

variable "match_events_topic_arn" {
  type        = string
  description = "ARN of the SNS topic for match events"
}

variable "fanout_lambda_arn" {
  type        = string
  description = "ARN of the Notification Service fanout Lambda"
}

variable "fanout_lambda_function_name" {
  type        = string
  description = "Function name of the Notification Service fanout Lambda"
}

variable "fanout_lambda_role_name" {
  type        = string
  description = "Execution role name of the Notification Service fanout Lambda"
}

variable "dynamodb_table_arn" {
  type        = string
  description = "ARN of the main DynamoDB table"
}
