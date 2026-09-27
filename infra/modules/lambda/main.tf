# ==============================================================================
# Polyglot Lambda Infrastructure Module
# ==============================================================================
# Manages the AWS Lambda function resource, execution IAM role, and policies
# for both Go custom runtime (provided.al2023) and Node.js (nodejs20.x).
# ==============================================================================

# Lambda execution IAM role
resource "aws_iam_role" "lambda_exec" {
  name = "${var.function_name}-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# Standard CloudWatch logs policy (AWSLambdaBasicExecutionRole equivalent)
resource "aws_iam_role_policy" "logging" {
  name = "${var.function_name}-logging-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# DynamoDB access policy: grants GetItem, PutItem, and Query on the table and all GSIs
# Attached when enable_dynamodb_access is true
resource "aws_iam_role_policy" "dynamodb" {
  count = var.enable_dynamodb_access ? 1 : 0
  name  = "${var.function_name}-dynamodb-policy"
  role  = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query"
        ]
        Resource = [
          var.dynamodb_table_arn,
          "${var.dynamodb_table_arn}/index/*"
        ]
      }
    ]
  })
}

# Lambda function definition
resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  runtime          = var.runtime
  handler          = var.handler
  filename         = var.artifact_path
  source_code_hash = fileexists(var.artifact_path) ? filebase64sha256(var.artifact_path) : null
  role             = aws_iam_role.lambda_exec.arn
  timeout          = var.timeout
  memory_size      = var.memory_size

  depends_on = [
    aws_iam_role.lambda_exec,
    aws_iam_role_policy.logging
  ]

  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []
    content {
      variables = var.environment_variables
    }
  }
}

# Optional event source mapping (e.g. for DynamoDB Streams or SQS)
resource "aws_lambda_event_source_mapping" "this" {
  count                   = var.enable_event_source_mapping ? 1 : 0
  event_source_arn        = var.event_source_arn
  function_name           = aws_lambda_function.this.arn
  starting_position       = "LATEST"
  batch_size              = var.event_source_batch_size
  function_response_types = ["ReportBatchItemFailures"]

  depends_on = [
    aws_lambda_function.this,
    var.depends_on_resources
  ]
}

