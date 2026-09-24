# ==============================================================================
# Lambda Module Outputs
# ==============================================================================

output "function_name" {
  description = "The name of the Lambda function"
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "The Amazon Resource Name (ARN) of the Lambda function"
  value       = aws_lambda_function.this.arn
}

output "invoke_arn" {
  description = "The invoke ARN of the Lambda function (used by API Gateway integrations)"
  value       = aws_lambda_function.this.invoke_arn
}

output "role_arn" {
  description = "The ARN of the IAM role attached to the Lambda function"
  value       = aws_iam_role.lambda_exec.arn
}

output "role_name" {
  description = "The name of the IAM role attached to the Lambda function"
  value       = aws_iam_role.lambda_exec.name
}

