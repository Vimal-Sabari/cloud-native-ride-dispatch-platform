output "location_events_queue_url" {
  description = "URL of the location events SQS queue"
  value       = aws_sqs_queue.location_events.url
}

output "location_events_queue_arn" {
  description = "ARN of the location events SQS queue"
  value       = aws_sqs_queue.location_events.arn
}

output "location_events_dlq_arn" {
  description = "ARN of the location events Dead Letter Queue"
  value       = aws_sqs_queue.location_events_dlq.arn
}

output "location_events_queue_name" {
  description = "Name of the location events SQS queue"
  value       = aws_sqs_queue.location_events.name
}

output "location_events_dlq_name" {
  description = "Name of the location events Dead Letter Queue"
  value       = aws_sqs_queue.location_events_dlq.name
}

output "ride_request_events_queue_url" {
  description = "URL of the ride-request events SQS queue"
  value       = aws_sqs_queue.ride_request_events.url
}

output "ride_request_events_queue_arn" {
  description = "ARN of the ride-request events SQS queue"
  value       = aws_sqs_queue.ride_request_events.arn
}

output "ride_request_events_dlq_arn" {
  description = "ARN of the ride-request events Dead Letter Queue"
  value       = aws_sqs_queue.ride_request_events_dlq.arn
}

output "ride_request_events_queue_name" {
  description = "Name of the ride-request events SQS queue"
  value       = aws_sqs_queue.ride_request_events.name
}

output "ride_request_events_dlq_name" {
  description = "Name of the ride-request events Dead Letter Queue"
  value       = aws_sqs_queue.ride_request_events_dlq.name
}

output "match_events_topic_arn" {
  description = "ARN of the SNS topic for match events"
  value       = aws_sns_topic.match_events.arn
}
