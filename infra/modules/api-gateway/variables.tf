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

# ------------------------------------------------------------------------------
# Trip Service Lambda Variables
# ------------------------------------------------------------------------------

variable "trip_request_ride_lambda_invoke_arn" {
  description = "Invoke ARN of the request-ride Lambda function"
  type        = string
}

variable "trip_request_ride_lambda_function_name" {
  description = "Function name of the request-ride Lambda function"
  type        = string
}

variable "trip_get_ride_lambda_invoke_arn" {
  description = "Invoke ARN of the get-ride Lambda function"
  type        = string
}

variable "trip_get_ride_lambda_function_name" {
  description = "Function name of the get-ride Lambda function"
  type        = string
}

variable "trip_cancel_ride_lambda_invoke_arn" {
  description = "Invoke ARN of the cancel-ride Lambda function"
  type        = string
}

variable "trip_cancel_ride_lambda_function_name" {
  description = "Function name of the cancel-ride Lambda function"
  type        = string
}

variable "trip_list_rider_rides_lambda_invoke_arn" {
  description = "Invoke ARN of the list-rider-rides Lambda function"
  type        = string
}

variable "trip_list_rider_rides_lambda_function_name" {
  description = "Function name of the list-rider-rides Lambda function"
  type        = string
}

variable "trip_assign_driver_lambda_invoke_arn" {
  description = "Invoke ARN of the assign-driver Lambda function"
  type        = string
}

variable "trip_assign_driver_lambda_function_name" {
  description = "Function name of the assign-driver Lambda function"
  type        = string
}

