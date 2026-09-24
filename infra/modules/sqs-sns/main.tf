# ==============================================================================
# SQS and SNS Messaging Infrastructure
# ==============================================================================
# NOTE: These are STANDARD (not FIFO) queues, deliberately — this system handles
# duplicate/out-of-order delivery at the application layer via the conditional-write
# idempotency patterns already established in the DynamoDB client wrappers and Trip
# Service's state machine, not via queue-level ordering guarantees, which would add
# complexity and (for FIFO specifically) a less free-tier-friendly pricing model
# without a clear benefit here.
# ==============================================================================

# ------------------------------------------------------------------------------
# Location Events Queue Pair
# ------------------------------------------------------------------------------

resource "aws_sqs_queue" "location_events_dlq" {
  name                      = "${var.project_name}-${var.environment}-location-events-dlq"
  message_retention_seconds = 1209600 # 14 days, generous DLQ retention for investigation
}

resource "aws_sqs_queue" "location_events" {
  name                       = "${var.project_name}-${var.environment}-location-events"
  visibility_timeout_seconds = 30  # sized for Matching Service's worst-case per-message processing time (geo lookup + match attempt + synchronous Trip Service callback) — see docs/design-decisions.md for the full reasoning; revisit after Module 28 load testing
  message_retention_seconds  = 300 # 5 minutes — a stale, unprocessed location update has no value; short retention is intentional
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.location_events_dlq.arn
    maxReceiveCount     = 5
  })
}

# ------------------------------------------------------------------------------
# Ride-Request Events Queue Pair
# ------------------------------------------------------------------------------
# A longer message_retention_seconds (3600 — 1 hour) is configured here compared to
# location updates (300 seconds), because the two event types have fundamentally
# different "staleness tolerance": a ride request is substantially more valuable to
# eventually process than a stale, transient location ping, even if matching is
# temporarily delayed or experiencing a burst window.

resource "aws_sqs_queue" "ride_request_events_dlq" {
  name                      = "${var.project_name}-${var.environment}-ride-request-events-dlq"
  message_retention_seconds = 1209600 # 14 days, generous DLQ retention for investigation
}

resource "aws_sqs_queue" "ride_request_events" {
  name                       = "${var.project_name}-${var.environment}-ride-request-events"
  visibility_timeout_seconds = 30   # sized for Matching Service's worst-case per-message processing time
  message_retention_seconds  = 3600 # 1 hour — ride requests remain valuable even if processing is delayed
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ride_request_events_dlq.arn
    maxReceiveCount     = 5
  })
}

# ------------------------------------------------------------------------------
# SNS Topic: Match Events
# ------------------------------------------------------------------------------

resource "aws_sns_topic" "match_events" {
  name = "${var.project_name}-${var.environment}-match-events"
}
