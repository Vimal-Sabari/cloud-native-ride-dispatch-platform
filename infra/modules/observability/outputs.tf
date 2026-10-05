# ==============================================================================
# Observability Module Outputs
# ==============================================================================

output "ops_alerts_topic_arn" {
  description = "ARN of the SNS topic for operational alerts"
  value       = aws_sns_topic.ops_alerts.arn
}

output "dashboard_name" {
  description = "Name of the CloudWatch platform overview dashboard"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}
