# ==============================================================================
# API Gateway WebSocket API Module (Notification Service)
# ==============================================================================
# Manages the WebSocket API Gateway for real-time driver and rider notifications:
#   - $connect route    -> connect Lambda (JWT validation & session persistence)
#   - $disconnect route -> disconnect Lambda (cleanup of session mappings)
# ==============================================================================

resource "aws_apigatewayv2_api" "websocket" {
  name                       = "${var.project_name}-${var.environment}-websocket-api"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

# ------------------------------------------------------------------------------
# Integrations (AWS_PROXY)
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "connect" {
  api_id           = aws_apigatewayv2_api.websocket.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.connect_lambda_invoke_arn
}

resource "aws_apigatewayv2_integration" "disconnect" {
  api_id           = aws_apigatewayv2_api.websocket.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.disconnect_lambda_invoke_arn
}

# ------------------------------------------------------------------------------
# Routes ($connect, $disconnect)
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_route" "connect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.connect.id}"
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.disconnect.id}"
}

# ------------------------------------------------------------------------------
# Stage (Auto-Deploy)
# ------------------------------------------------------------------------------
# Architectural note on deployment strategy:
# auto_deploy = true is chosen here over a manually-triggered deployment resource
# (aws_apigatewayv2_deployment). In this platform's development, testing, and CI scale,
# routes and integrations update infrequently and auto-deploy guarantees immediate,
# consistent propagation without the need to manage deployment hash triggers or
# lifecycle replace-order race conditions.
resource "aws_apigatewayv2_stage" "stage" {
  api_id      = aws_apigatewayv2_api.websocket.id
  name        = var.environment
  auto_deploy = true
}

# ------------------------------------------------------------------------------
# Lambda Permissions
# ------------------------------------------------------------------------------

resource "aws_lambda_permission" "connect" {
  statement_id  = "AllowExecutionFromAPIGatewayWebSocketConnect"
  action        = "lambda:InvokeFunction"
  function_name = var.connect_lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket.execution_arn}/*/$connect"
}

resource "aws_lambda_permission" "disconnect" {
  statement_id  = "AllowExecutionFromAPIGatewayWebSocketDisconnect"
  action        = "lambda:InvokeFunction"
  function_name = var.disconnect_lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket.execution_arn}/*/$disconnect"
}

# ------------------------------------------------------------------------------
# SNS Subscription & Permissions (Fan-Out Lambda)
# ------------------------------------------------------------------------------

resource "aws_sns_topic_subscription" "fanout" {
  topic_arn = var.match_events_topic_arn
  protocol  = "lambda"
  endpoint  = var.fanout_lambda_arn
}

resource "aws_lambda_permission" "sns_invoke_fanout" {
  statement_id  = "AllowExecutionFromSNSMatchEvents"
  action        = "lambda:InvokeFunction"
  function_name = var.fanout_lambda_function_name
  principal     = "sns.amazonaws.com"
  source_arn    = var.match_events_topic_arn
}

resource "aws_iam_role_policy" "fanout_manage_connections" {
  name = "${var.project_name}-${var.environment}-fanout-manage-connections"
  role = var.fanout_lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "execute-api:ManageConnections"
        ]
        Resource = "arn:aws:execute-api:*:*:${aws_apigatewayv2_api.websocket.id}/*/*/@connections/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:DeleteItem"
        ]
        Resource = [
          var.dynamodb_table_arn,
          "${var.dynamodb_table_arn}/index/*"
        ]
      }
    ]
  })
}
