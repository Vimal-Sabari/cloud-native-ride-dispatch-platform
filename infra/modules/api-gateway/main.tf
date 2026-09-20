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
# Lambda Permissions: Allow API Gateway invocation (Location Service & Authorizer)
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

# ==============================================================================
# Trip Service Resources & Endpoints (Module 13)
# ==============================================================================

# ------------------------------------------------------------------------------
# Resource Tree: /riders/{id}/rides (POST: Request Ride, GET: List Rider Rides)
# ------------------------------------------------------------------------------

# /riders
resource "aws_api_gateway_resource" "riders" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "riders"
}

# /riders/{id}
resource "aws_api_gateway_resource" "rider_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.riders.id
  path_part   = "{id}"
}

# /riders/{id}/rides
resource "aws_api_gateway_resource" "rider_rides" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.rider_id.id
  path_part   = "rides"
}

# POST /riders/{id}/rides (Request Ride)
resource "aws_api_gateway_method" "request_ride_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.rider_rides.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.jwt.id

  request_parameters = {
    "method.request.header.Authorization" = true
  }
}

resource "aws_api_gateway_integration" "request_ride_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.rider_rides.id
  http_method             = aws_api_gateway_method.request_ride_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.trip_request_ride_lambda_invoke_arn
}

# GET /riders/{id}/rides (List Rider Rides)
resource "aws_api_gateway_method" "list_rider_rides_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.rider_rides.id
  http_method   = "GET"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.jwt.id

  request_parameters = {
    "method.request.header.Authorization" = true
  }
}

resource "aws_api_gateway_integration" "list_rider_rides_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.rider_rides.id
  http_method             = aws_api_gateway_method.list_rider_rides_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.trip_list_rider_rides_lambda_invoke_arn
}

# ------------------------------------------------------------------------------
# Resource Tree: /rides/{id} (GET: Get Ride) & /rides/{id}/cancel (POST: Cancel)
# ------------------------------------------------------------------------------

# /rides
resource "aws_api_gateway_resource" "rides" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "rides"
}

# /rides/{id}
resource "aws_api_gateway_resource" "ride_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.rides.id
  path_part   = "{id}"
}

# GET /rides/{id} (Get Ride Details)
resource "aws_api_gateway_method" "get_ride_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.ride_id.id
  http_method   = "GET"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.jwt.id

  request_parameters = {
    "method.request.header.Authorization" = true
  }
}

resource "aws_api_gateway_integration" "get_ride_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.ride_id.id
  http_method             = aws_api_gateway_method.get_ride_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.trip_get_ride_lambda_invoke_arn
}

# /rides/{id}/cancel
resource "aws_api_gateway_resource" "ride_cancel" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.ride_id.id
  path_part   = "cancel"
}

# POST /rides/{id}/cancel (Cancel Ride)
resource "aws_api_gateway_method" "cancel_ride_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.ride_cancel.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.jwt.id

  request_parameters = {
    "method.request.header.Authorization" = true
  }
}

resource "aws_api_gateway_integration" "cancel_ride_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.ride_cancel.id
  http_method             = aws_api_gateway_method.cancel_ride_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.trip_cancel_ride_lambda_invoke_arn
}

# ------------------------------------------------------------------------------
# Resource Tree: /internal/rides/{id}/assign-driver
# ------------------------------------------------------------------------------

# /internal
resource "aws_api_gateway_resource" "internal" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "internal"
}

# /internal/rides
resource "aws_api_gateway_resource" "internal_rides" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.internal.id
  path_part   = "rides"
}

# /internal/rides/{id}
resource "aws_api_gateway_resource" "internal_ride_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.internal_rides.id
  path_part   = "{id}"
}

# /internal/rides/{id}/assign-driver
resource "aws_api_gateway_resource" "internal_assign_driver" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.internal_ride_id.id
  path_part   = "assign-driver"
}

# ------------------------------------------------------------------------------
# Method & Integration: POST /internal/rides/{id}/assign-driver
#
# Architecture & Security Note:
# This route is intentionally unauthenticated at the API Gateway layer (authorization = "NONE")
# because its protection is a handler-level shared-secret check (x-internal-api-key), since
# its only legitimate caller is Matching Service's internal EC2 daemon process, not an end user.
# This is a deliberate design choice, not an oversight.
# ------------------------------------------------------------------------------
resource "aws_api_gateway_method" "assign_driver_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.internal_assign_driver.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "assign_driver_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.internal_assign_driver.id
  http_method             = aws_api_gateway_method.assign_driver_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.trip_assign_driver_lambda_invoke_arn
}

# ------------------------------------------------------------------------------
# Lambda Permissions: Allow API Gateway invocation for Trip Service Lambdas
# ------------------------------------------------------------------------------

resource "aws_lambda_permission" "trip_request_ride" {
  statement_id  = "AllowAPIGatewayInvokeTripRequestRide"
  action        = "lambda:InvokeFunction"
  function_name = var.trip_request_ride_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

resource "aws_lambda_permission" "trip_list_rider_rides" {
  statement_id  = "AllowAPIGatewayInvokeTripListRiderRides"
  action        = "lambda:InvokeFunction"
  function_name = var.trip_list_rider_rides_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

resource "aws_lambda_permission" "trip_get_ride" {
  statement_id  = "AllowAPIGatewayInvokeTripGetRide"
  action        = "lambda:InvokeFunction"
  function_name = var.trip_get_ride_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

resource "aws_lambda_permission" "trip_cancel_ride" {
  statement_id  = "AllowAPIGatewayInvokeTripCancelRide"
  action        = "lambda:InvokeFunction"
  function_name = var.trip_cancel_ride_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

resource "aws_lambda_permission" "trip_assign_driver" {
  statement_id  = "AllowAPIGatewayInvokeTripAssignDriver"
  action        = "lambda:InvokeFunction"
  function_name = var.trip_assign_driver_lambda_function_name
  principal     = "apigateway.amazonaws.com"
}

# ------------------------------------------------------------------------------
# Deployment & Stage
# ------------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha1(jsonencode([
      # Location Service resources & methods
      aws_api_gateway_resource.drivers.id,
      aws_api_gateway_resource.driver_id.id,
      aws_api_gateway_resource.location.id,
      aws_api_gateway_resource.status.id,
      aws_api_gateway_method.location_post.id,
      aws_api_gateway_integration.location_post.id,
      aws_api_gateway_method.status_post.id,
      aws_api_gateway_integration.status_post.id,
      aws_api_gateway_authorizer.jwt.id,

      # Trip Service resources & methods
      aws_api_gateway_resource.riders.id,
      aws_api_gateway_resource.rider_id.id,
      aws_api_gateway_resource.rider_rides.id,
      aws_api_gateway_method.request_ride_post.id,
      aws_api_gateway_integration.request_ride_post.id,
      aws_api_gateway_method.list_rider_rides_get.id,
      aws_api_gateway_integration.list_rider_rides_get.id,
      aws_api_gateway_resource.rides.id,
      aws_api_gateway_resource.ride_id.id,
      aws_api_gateway_method.get_ride_get.id,
      aws_api_gateway_integration.get_ride_get.id,
      aws_api_gateway_resource.ride_cancel.id,
      aws_api_gateway_method.cancel_ride_post.id,
      aws_api_gateway_integration.cancel_ride_post.id,
      aws_api_gateway_resource.internal.id,
      aws_api_gateway_resource.internal_rides.id,
      aws_api_gateway_resource.internal_ride_id.id,
      aws_api_gateway_resource.internal_assign_driver.id,
      aws_api_gateway_method.assign_driver_post.id,
      aws_api_gateway_integration.assign_driver_post.id
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.location_post,
    aws_api_gateway_integration.status_post,
    aws_api_gateway_integration.request_ride_post,
    aws_api_gateway_integration.list_rider_rides_get,
    aws_api_gateway_integration.get_ride_get,
    aws_api_gateway_integration.cancel_ride_post,
    aws_api_gateway_integration.assign_driver_post
  ]
}

resource "aws_api_gateway_stage" "main" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = var.environment
}

