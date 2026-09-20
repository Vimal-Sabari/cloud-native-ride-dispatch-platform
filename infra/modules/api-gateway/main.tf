# ==============================================================================
# API Gateway REST API Module
# ==============================================================================
# Manages the unified REST API surface for the ride-dispatch platform.
# Currently exposes Location Service endpoints with custom JWT token authorization:
#   - POST /drivers/{id}/location -> update-location Lambda
#   - POST /drivers/{id}/status   -> update-status Lambda
# ==============================================================================

resource "aws_api_gateway_rest_api" "main" {
  name        = "${var.project_name}-${var.environment}-api"
  description = "Unified REST API Gateway for Ride Dispatch Platform"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# ------------------------------------------------------------------------------
# Custom JWT Token Authorizer (Module 8 Lambda Authorizer)
# ------------------------------------------------------------------------------
resource "aws_api_gateway_authorizer" "jwt" {
  name                             = "${var.project_name}-${var.environment}-jwt-authorizer"
  rest_api_id                      = aws_api_gateway_rest_api.main.id
  authorizer_uri                   = var.authorizer_lambda_invoke_arn
  type                             = "TOKEN"
  identity_source                  = "method.request.header.Authorization"
  authorizer_result_ttl_in_seconds = 0
}

# ------------------------------------------------------------------------------
# Resource Tree: /drivers/{id}/location and /drivers/{id}/status
# ------------------------------------------------------------------------------

# /drivers
resource "aws_api_gateway_resource" "drivers" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "drivers"
}

# /drivers/{id}
resource "aws_api_gateway_resource" "driver_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.drivers.id
  path_part   = "{id}"
}

# /drivers/{id}/location
resource "aws_api_gateway_resource" "location" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.driver_id.id
  path_part   = "location"
}

# /drivers/{id}/status
resource "aws_api_gateway_resource" "status" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.driver_id.id
  path_part   = "status"
}

# ------------------------------------------------------------------------------
# Method & Integration: POST /drivers/{id}/location
# ------------------------------------------------------------------------------
resource "aws_api_gateway_method" "location_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.location.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.jwt.id

  request_parameters = {
    "method.request.header.Authorization" = true
  }
}

resource "aws_api_gateway_integration" "location_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.location.id
  http_method             = aws_api_gateway_method.location_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.location_lambda_invoke_arn
}

# ------------------------------------------------------------------------------
# Method & Integration: POST /drivers/{id}/status
# ------------------------------------------------------------------------------
resource "aws_api_gateway_method" "status_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.status.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.jwt.id

  request_parameters = {
    "method.request.header.Authorization" = true
  }
}

resource "aws_api_gateway_integration" "status_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.status.id
  http_method             = aws_api_gateway_method.status_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.status_lambda_invoke_arn
}

# ------------------------------------------------------------------------------
# Lambda Permissions: Allow API Gateway invocation
# ------------------------------------------------------------------------------

resource "aws_lambda_permission" "authorizer" {
  statement_id  = "AllowAPIGatewayInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = var.authorizer_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

resource "aws_lambda_permission" "location" {
  statement_id  = "AllowAPIGatewayInvokeLocation"
  action        = "lambda:InvokeFunction"
  function_name = var.location_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

resource "aws_lambda_permission" "status" {
  statement_id  = "AllowAPIGatewayInvokeStatus"
  action        = "lambda:InvokeFunction"
  function_name = var.status_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

# ------------------------------------------------------------------------------
# Deployment & Stage
# ------------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.drivers.id,
      aws_api_gateway_resource.driver_id.id,
      aws_api_gateway_resource.location.id,
      aws_api_gateway_resource.status.id,
      aws_api_gateway_method.location_post.id,
      aws_api_gateway_integration.location_post.id,
      aws_api_gateway_method.status_post.id,
      aws_api_gateway_integration.status_post.id,
      aws_api_gateway_authorizer.jwt.id
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.location_post,
    aws_api_gateway_integration.status_post
  ]
}

resource "aws_api_gateway_stage" "main" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = var.environment
}
