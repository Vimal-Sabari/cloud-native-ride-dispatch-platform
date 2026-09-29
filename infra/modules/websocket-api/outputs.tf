output "invoke_url" {
  description = "The WebSocket API Gateway invoke URL"
  value       = aws_apigatewayv2_stage.stage.invoke_url
}

output "api_id" {
  description = "The WebSocket API ID"
  value       = aws_apigatewayv2_api.websocket.id
}

output "api_endpoint" {
  description = "The WebSocket API endpoint"
  value       = aws_apigatewayv2_api.websocket.api_endpoint
}

output "execution_arn" {
  description = "The execution ARN of the WebSocket API"
  value       = aws_apigatewayv2_api.websocket.execution_arn
}

output "stage_name" {
  description = "The stage name of the WebSocket API"
  value       = aws_apigatewayv2_stage.stage.name
}
