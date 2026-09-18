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
