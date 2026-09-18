# ==============================================================================
# DynamoDB Single-Table Schema
# ==============================================================================
# Single-table design for ride-dispatch-platform with 3 Global Secondary Indexes (GSIs).
# ==============================================================================

resource "aws_dynamodb_table" "main" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  # Core primary key attributes
  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # GSI1 attributes: Query available drivers within a geohash cell
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # GSI2 attributes: Query all rides for a rider, sorted by creation time
  attribute {
    name = "GSI2PK"
    type = "S"
  }

  attribute {
    name = "GSI2SK"
    type = "S"
  }

  # GSI3 attributes: Check if a driver has an active trip assigned
  attribute {
    name = "GSI3PK"
    type = "S"
  }

  attribute {
    name = "GSI3SK"
    type = "S"
  }

  # GSI1: Driver availability by geohash
  # Purpose: Query all available drivers within a geohash cell.
  # Example: GSI1PK = "GEOHASH#u4pruy", GSI1SK = "DRIVER#AVAILABLE#driver-123"
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # GSI2: Rider trip history
  # Purpose: Query all rides for a given rider, sorted by creation time.
  # Example: GSI2PK = "RIDER#rider-456", GSI2SK = "RIDE#2026-09-18T10:00:00Z#ride-789"
  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  # GSI3: Active trip driver assignment guard
  # Purpose: Quickly check if a driver already has an active trip assigned (present only while a trip is active).
  # Example: GSI3PK = "DRIVER#driver-123", GSI3SK = "ACTIVE_RIDE"
  global_secondary_index {
    name            = "GSI3"
    hash_key        = "GSI3PK"
    range_key       = "GSI3SK"
    projection_type = "ALL"
  }

  # Time-to-Live: auto-expire stale driver-location heartbeat records in Location Service
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Point-in-time recovery: disabled as an explicit cost-conscious choice for AWS Free Tier
  # development/demo environment, not an oversight. Can be enabled for production workloads.
  point_in_time_recovery {
    enabled = false
  }

  tags = {
    Environment = var.environment
    Project     = "ride-dispatch-platform"
  }
}
