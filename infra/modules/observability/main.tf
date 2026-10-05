# ==============================================================================
# Observability Module: Alarms, SNS Notifications, and CloudWatch Dashboard
# ==============================================================================

# ------------------------------------------------------------------------------
# Ops Alerts SNS Topic & Email Subscription
# ------------------------------------------------------------------------------

resource "aws_sns_topic" "ops_alerts" {
  name = "${var.project_name}-${var.environment}-ops-alerts"
}

# NOTE: The email protocol subscription requires a one-time manual confirmation click
# from the recipient email address before alerts will actually be delivered by AWS.
resource "aws_sns_topic_subscription" "ops_alerts_email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.ops_alert_email
}

# ------------------------------------------------------------------------------
# Dead Letter Queue (DLQ) Depth Alarms
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ride_request_dlq_depth" {
  alarm_name          = "${var.project_name}-${var.environment}-ride-request-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  dimensions = {
    QueueName = var.ride_request_dlq_name
  }
  alarm_actions     = [aws_sns_topic.ops_alerts.arn]
  alarm_description = "Fires when any message lands in the ride-request-events DLQ, indicating repeated processing failures."
}

resource "aws_cloudwatch_metric_alarm" "location_events_dlq_depth" {
  alarm_name          = "${var.project_name}-${var.environment}-location-events-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  dimensions = {
    QueueName = var.location_events_dlq_name
  }
  alarm_actions     = [aws_sns_topic.ops_alerts.arn]
  alarm_description = "Fires when any message lands in the location-events DLQ, indicating repeated processing failures."
}

# ------------------------------------------------------------------------------
# CloudWatch Platform Overview Dashboard
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project_name}-${var.environment}-platform-overview"

  dashboard_body = jsonencode({
    widgets = [
      # Widget A1: Location Service EMF Metrics (Row 1, left)
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Location Service - Request & Error Counts (EMF)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            ["RideDispatch/LocationService", "RequestCount", "Route", "update-location", { stat = "Sum", label = "Location Updates (Success)" }],
            ["RideDispatch/LocationService", "ErrorCount", "Route", "update-location", { stat = "Sum", label = "Location Updates (Errors)" }]
          ]
        }
      },

      # Widget A2: Trip Service EMF Metrics (Row 1, right)
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Trip Service - Request & Error Counts (EMF)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            ["RideDispatch/TripService", "RequestCount", "Route", "request-ride", { stat = "Sum", label = "Ride Requests (Success)" }],
            ["RideDispatch/TripService", "ErrorCount", "Route", "request-ride", { stat = "Sum", label = "Ride Requests (Errors)" }]
          ]
        }
      },

      # Widget B: Matching Service Attempts & Outcomes (Row 2, left)
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Matching Service - Match Attempts, Successes & Failures (EMF)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            ["RideDispatch/MatchingService", "MatchAttempted", "Strategy", "naive", { stat = "Sum", label = "Naive Attempts" }],
            ["RideDispatch/MatchingService", "MatchSucceeded", "Strategy", "naive", { stat = "Sum", label = "Naive Succeeded" }],
            ["RideDispatch/MatchingService", "MatchFailed", "Strategy", "naive", { stat = "Sum", label = "Naive Failed" }],
            ["RideDispatch/MatchingService", "MatchAttempted", "Strategy", "batch", { stat = "Sum", label = "Batch Attempts" }],
            ["RideDispatch/MatchingService", "MatchSucceeded", "Strategy", "batch", { stat = "Sum", label = "Batch Succeeded" }],
            ["RideDispatch/MatchingService", "MatchFailed", "Strategy", "batch", { stat = "Sum", label = "Batch Failed" }]
          ]
        }
      },

      # Widget C: Matching Service Decision Latency by Strategy (Row 2, right)
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Matching Service - Decision Duration by Strategy (EMF)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          yAxis = {
            left = {
              label = "Milliseconds"
            }
          }
          metrics = [
            ["RideDispatch/MatchingService", "MatchDecisionDurationMs", "Strategy", "naive", { stat = "Average", label = "Naive Duration (Avg)" }],
            ["RideDispatch/MatchingService", "MatchDecisionDurationMs", "Strategy", "naive", { stat = "p99", label = "Naive Duration (p99)" }],
            ["RideDispatch/MatchingService", "MatchDecisionDurationMs", "Strategy", "batch", { stat = "Average", label = "Batch Duration (Avg)" }],
            ["RideDispatch/MatchingService", "MatchDecisionDurationMs", "Strategy", "batch", { stat = "p99", label = "Batch Duration (p99)" }]
          ]
        }
      },

      # Widget D: SQS Queue Depths - Main Queues & DLQs (Row 3, left)
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "SQS Queue Depths - Main Queues & DLQs"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          yAxis = {
            left = {
              label = "Messages Visible"
            }
          }
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.location_events_queue_name, { stat = "Maximum", label = "Location Events Queue" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.location_events_dlq_name, { stat = "Maximum", label = "Location Events DLQ" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.ride_request_queue_name, { stat = "Maximum", label = "Ride Request Events Queue" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.ride_request_dlq_name, { stat = "Maximum", label = "Ride Request Events DLQ" }]
          ]
        }
      },

      # Widget F: DynamoDB Consumed Capacity & Throttling (Row 3, right)
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "DynamoDB - Capacity Units & Throttled Requests"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", var.dynamodb_table_name, { stat = "Sum", label = "Consumed Read Capacity" }],
            ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", var.dynamodb_table_name, { stat = "Sum", label = "Consumed Write Capacity" }],
            ["AWS/DynamoDB", "ThrottledRequests", "TableName", var.dynamodb_table_name, { stat = "Sum", label = "Throttled Requests" }]
          ]
        }
      },

      # Widget E1: Lambda Invocations (Row 4, left)
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 8
        height = 6
        properties = {
          title   = "Lambda - Invocations"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            for fn in var.lambda_function_names : [
              "AWS/Lambda", "Invocations", "FunctionName", fn, { stat = "Sum", label = fn }
            ]
          ]
        }
      },

      # Widget E2: Lambda Errors (Row 4, middle)
      {
        type   = "metric"
        x      = 8
        y      = 18
        width  = 8
        height = 6
        properties = {
          title   = "Lambda - Errors"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            for fn in var.lambda_function_names : [
              "AWS/Lambda", "Errors", "FunctionName", fn, { stat = "Sum", label = fn }
            ]
          ]
        }
      },

      # Widget E3: Lambda Duration (p99) (Row 4, right)
      {
        type   = "metric"
        x      = 16
        y      = 18
        width  = 8
        height = 6
        properties = {
          title   = "Lambda - Duration (p99)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          yAxis = {
            left = {
              label = "Milliseconds"
            }
          }
          metrics = [
            for fn in var.lambda_function_names : [
              "AWS/Lambda", "Duration", "FunctionName", fn, { stat = "p99", label = fn }
            ]
          ]
        }
      }
    ]
  })
}
