terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  dynamic "endpoints" {
    for_each = var.environment == "local" ? [1] : []
    content {
      apigateway = "http://localhost:4566"
      cloudwatch = "http://localhost:4566"
      dynamodb   = "http://localhost:4566"
      ec2        = "http://localhost:4566"
      iam        = "http://localhost:4566"
      lambda     = "http://localhost:4566"
      logs       = "http://localhost:4566"
      s3         = "http://localhost:4566"
      sns        = "http://localhost:4566"
      sqs        = "http://localhost:4566"
      sts        = "http://localhost:4566"
    }
  }

  access_key                  = var.environment == "local" ? "test" : null
  secret_key                  = var.environment == "local" ? "test" : null
  skip_credentials_validation = var.environment == "local"
  skip_metadata_api_check     = var.environment == "local"
  skip_requesting_account_id  = false
  s3_use_path_style           = var.environment == "local"
}

module "dynamodb" {
  source      = "./modules/dynamodb"
  table_name  = "${var.project_name}-${var.environment}"
  environment = var.environment
}

module "sqs_sns" {
  source = "./modules/sqs-sns"
}

# Module 8 JWT Authorizer Lambda (TypeScript runtime)
module "auth_authorizer_lambda" {
  source        = "./modules/lambda"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  artifact_path = "${path.module}/../services/auth-stub/authorizer.zip"
  function_name = "${var.project_name}-${var.environment}-auth-authorizer"
  timeout       = 10
  memory_size   = 128

  environment_variables = {
    JWT_SECRET = "dev-jwt-secret-for-ride-dispatch-local-testing"
  }
}

# Location Service - Update Location Lambda (Go custom runtime)
module "location_update_location_lambda" {
  source                 = "./modules/lambda"
  runtime                = "provided.al2023"
  handler                = "bootstrap"
  artifact_path          = "${path.module}/../services/location-service/update-location.zip"
  function_name          = "${var.project_name}-${var.environment}-location-update-location"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

# Location Service - Update Status Lambda (Go custom runtime)
module "location_update_status_lambda" {
  source                 = "./modules/lambda"
  runtime                = "provided.al2023"
  handler                = "bootstrap"
  artifact_path          = "${path.module}/../services/location-service/update-status.zip"
  function_name          = "${var.project_name}-${var.environment}-location-update-status"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

# ------------------------------------------------------------------------------
# Trip Service Lambdas (TypeScript / Node.js 20.x runtime)
# ------------------------------------------------------------------------------

# Trip Service - Request Ride Lambda
module "trip_request_ride_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.handler"
  artifact_path          = "${path.module}/../services/trip-service/request-ride.zip"
  function_name          = "${var.project_name}-${var.environment}-trip-request-ride"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    RIDES_TABLE       = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

# Trip Service - Get Ride Lambda
module "trip_get_ride_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.handler"
  artifact_path          = "${path.module}/../services/trip-service/get-ride.zip"
  function_name          = "${var.project_name}-${var.environment}-trip-get-ride"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    RIDES_TABLE       = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

# Trip Service - Cancel Ride Lambda
module "trip_cancel_ride_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.handler"
  artifact_path          = "${path.module}/../services/trip-service/cancel-ride.zip"
  function_name          = "${var.project_name}-${var.environment}-trip-cancel-ride"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    RIDES_TABLE       = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

# Trip Service - List Rider Rides Lambda
module "trip_list_rider_rides_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.handler"
  artifact_path          = "${path.module}/../services/trip-service/list-rider-rides.zip"
  function_name          = "${var.project_name}-${var.environment}-trip-list-rider-rides"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    RIDES_TABLE       = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

# Trip Service - Internal Assign Driver Lambda
module "trip_assign_driver_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.handler"
  artifact_path          = "${path.module}/../services/trip-service/assign-driver.zip"
  function_name          = "${var.project_name}-${var.environment}-trip-assign-driver"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    RIDES_TABLE       = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
    INTERNAL_API_KEY  = var.internal_api_key
  }
}


module "ec2_matching" {
  source = "./modules/ec2-matching"
}

module "api_gateway" {
  source                                     = "./modules/api-gateway"
  project_name                               = var.project_name
  environment                                = var.environment
  location_lambda_invoke_arn                 = module.location_update_location_lambda.invoke_arn
  location_lambda_function_name              = module.location_update_location_lambda.function_name
  status_lambda_invoke_arn                   = module.location_update_status_lambda.invoke_arn
  status_lambda_function_name                = module.location_update_status_lambda.function_name
  authorizer_lambda_invoke_arn               = module.auth_authorizer_lambda.invoke_arn
  authorizer_lambda_function_name            = module.auth_authorizer_lambda.function_name
  trip_request_ride_lambda_invoke_arn        = module.trip_request_ride_lambda.invoke_arn
  trip_request_ride_lambda_function_name     = module.trip_request_ride_lambda.function_name
  trip_get_ride_lambda_invoke_arn            = module.trip_get_ride_lambda.invoke_arn
  trip_get_ride_lambda_function_name         = module.trip_get_ride_lambda.function_name
  trip_cancel_ride_lambda_invoke_arn         = module.trip_cancel_ride_lambda.invoke_arn
  trip_cancel_ride_lambda_function_name      = module.trip_cancel_ride_lambda.function_name
  trip_list_rider_rides_lambda_invoke_arn    = module.trip_list_rider_rides_lambda.invoke_arn
  trip_list_rider_rides_lambda_function_name = module.trip_list_rider_rides_lambda.function_name
  trip_assign_driver_lambda_invoke_arn       = module.trip_assign_driver_lambda.invoke_arn
  trip_assign_driver_lambda_function_name    = module.trip_assign_driver_lambda.function_name
}

