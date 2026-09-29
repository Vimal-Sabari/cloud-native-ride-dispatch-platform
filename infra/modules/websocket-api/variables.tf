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
