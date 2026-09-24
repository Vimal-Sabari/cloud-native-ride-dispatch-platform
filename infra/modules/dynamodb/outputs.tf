output "table_name" {
  description = "The name of the DynamoDB single table"
  value       = aws_dynamodb_table.main.name
}

output "table_arn" {
  description = "The ARN of the DynamoDB single table"
  value       = aws_dynamodb_table.main.arn
}

output "gsi1_name" {
  description = "Name of GSI1 (geohash driver availability index)"
  value       = "GSI1"
}

output "gsi2_name" {
  description = "Name of GSI2 (rider trip history index)"
  value       = "GSI2"
}

output "gsi3_name" {
  description = "Name of GSI3 (driver active trip guard index)"
  value       = "GSI3"
}

output "stream_arn" {
  description = "The ARN of the DynamoDB stream"
  value       = aws_dynamodb_table.main.stream_arn
}

