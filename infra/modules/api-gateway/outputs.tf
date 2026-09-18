# ==============================================================================
# API Gateway Module Outputs
# ==============================================================================

output "rest_api_id" {
  description = "The ID of the REST API Gateway"
  value       = aws_api_gateway_rest_api.main.id
}

output "stage_name" {
  description = "The deployed stage name"
  value       = aws_api_gateway_stage.main.stage_name
}

output "invoke_url" {
  description = "The invoke URL for the API Gateway stage (supports both AWS domain and LocalStack path-style URLs)"
  value       = var.environment == "local" ? "http://localhost:4566/restapis/${aws_api_gateway_rest_api.main.id}/${var.environment}/_user_request_" : aws_api_gateway_stage.main.invoke_url
}
