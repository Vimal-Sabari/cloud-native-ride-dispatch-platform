output "dynamodb_table_name" {
  description = "The name of the DynamoDB single table"
  value       = module.dynamodb.table_name
}

output "dynamodb_table_arn" {
  description = "The ARN of the DynamoDB single table"
  value       = module.dynamodb.table_arn
}

output "dynamodb_gsi1_name" {
  description = "Name of GSI1 (geohash driver availability index)"
  value       = module.dynamodb.gsi1_name
}

output "dynamodb_gsi2_name" {
  description = "Name of GSI2 (rider trip history index)"
  value       = module.dynamodb.gsi2_name
}

output "dynamodb_gsi3_name" {
  description = "Name of GSI3 (driver active trip guard index)"
  value       = module.dynamodb.gsi3_name
}

output "api_gateway_invoke_url" {
  description = "Base invoke URL of the API Gateway deployment stage"
  value       = module.api_gateway.invoke_url
}

output "api_gateway_rest_api_id" {
  description = "The REST API Gateway ID"
  value       = module.api_gateway.rest_api_id
}

output "location_update_location_function_arn" {
  description = "ARN of the update-location Lambda function"
  value       = module.location_update_location_lambda.function_arn
}

output "location_update_status_function_arn" {
  description = "ARN of the update-status Lambda function"
  value       = module.location_update_status_lambda.function_arn
}

output "auth_authorizer_function_arn" {
  description = "ARN of the JWT authorizer Lambda function"
  value       = module.auth_authorizer_lambda.function_arn
}
