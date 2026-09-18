variable "table_name" {
  description = "Name of the DynamoDB single table"
  type        = string
}

variable "environment" {
  description = "Target deployment environment (local or aws-dev)"
  type        = string
}
