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

output "location_events_queue_url" {
  description = "URL of the location events SQS queue"
  value       = module.sqs_sns.location_events_queue_url
}

output "location_events_queue_arn" {
  description = "ARN of the location events SQS queue"
  value       = module.sqs_sns.location_events_queue_arn
}

output "location_events_dlq_arn" {
  description = "ARN of the location events Dead Letter Queue"
  value       = module.sqs_sns.location_events_dlq_arn
}

output "ride_request_events_queue_url" {
  description = "URL of the ride-request events SQS queue"
  value       = module.sqs_sns.ride_request_events_queue_url
}

output "ride_request_events_queue_arn" {
  description = "ARN of the ride-request events SQS queue"
  value       = module.sqs_sns.ride_request_events_queue_arn
}

output "ride_request_events_dlq_arn" {
  description = "ARN of the ride-request events Dead Letter Queue"
  value       = module.sqs_sns.ride_request_events_dlq_arn
}

output "match_events_topic_arn" {
  description = "ARN of the SNS topic for match events"
  value       = module.sqs_sns.match_events_topic_arn
}

output "event_forwarder_function_arn" {
  description = "ARN of the DynamoDB Streams event forwarder Lambda function"
  value       = module.event_forwarder_lambda.function_arn
}

output "matching_service_instance_id" {
  description = "The EC2 instance ID for Matching Service (empty in local environment)"
  value       = module.ec2_matching.instance_id
}

output "matching_service_public_ip" {
  description = "Public IP address of the Matching Service EC2 instance"
  value       = module.ec2_matching.public_ip
}

output "websocket_api_invoke_url" {
  description = "The WebSocket API Gateway invoke URL"
  value       = try(module.websocket_api[0].invoke_url, "")
}
