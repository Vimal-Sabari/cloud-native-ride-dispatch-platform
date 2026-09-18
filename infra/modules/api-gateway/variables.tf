# ==============================================================================
# API Gateway Module Interface Variables
# ==============================================================================

variable "project_name" {
  description = "Project name identifier used for resource naming"
  type        = string
}

variable "environment" {
  description = "Target deployment environment (local or aws-dev)"
  type        = string
}

variable "location_lambda_invoke_arn" {
  description = "Invoke ARN of the update-location Lambda function"
  type        = string
}

variable "location_lambda_function_name" {
  description = "Function name of the update-location Lambda function"
  type        = string
}

variable "status_lambda_invoke_arn" {
  description = "Invoke ARN of the update-status Lambda function"
  type        = string
}

variable "status_lambda_function_name" {
  description = "Function name of the update-status Lambda function"
  type        = string
}

variable "authorizer_lambda_invoke_arn" {
  description = "Invoke ARN of the JWT authorizer Lambda function"
  type        = string
}

variable "authorizer_lambda_function_name" {
  description = "Function name of the JWT authorizer Lambda function"
  type        = string
}
