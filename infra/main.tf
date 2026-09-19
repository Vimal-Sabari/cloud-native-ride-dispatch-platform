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
  skip_requesting_account_id  = var.environment == "local"
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
  source             = "./modules/lambda"
  runtime            = "provided.al2023"
  handler            = "bootstrap"
  artifact_path      = "${path.module}/../services/location-service/update-location.zip"
  function_name      = "${var.project_name}-${var.environment}-location-update-location"
  dynamodb_table_arn = module.dynamodb.table_arn
  timeout            = 10
  memory_size        = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

# Location Service - Update Status Lambda (Go custom runtime)
module "location_update_status_lambda" {
  source             = "./modules/lambda"
  runtime            = "provided.al2023"
  handler            = "bootstrap"
  artifact_path      = "${path.module}/../services/location-service/update-status.zip"
  function_name      = "${var.project_name}-${var.environment}-location-update-status"
  dynamodb_table_arn = module.dynamodb.table_arn
  timeout            = 10
  memory_size        = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localhost:4566" : ""
  }
}

module "ec2_matching" {
  source = "./modules/ec2-matching"
}

module "api_gateway" {
  source                          = "./modules/api-gateway"
  project_name                    = var.project_name
  environment                     = var.environment
  location_lambda_invoke_arn      = module.location_update_location_lambda.invoke_arn
  location_lambda_function_name   = module.location_update_location_lambda.function_name
  status_lambda_invoke_arn        = module.location_update_status_lambda.invoke_arn
  status_lambda_function_name     = module.location_update_status_lambda.function_name
  authorizer_lambda_invoke_arn    = module.auth_authorizer_lambda.invoke_arn
  authorizer_lambda_function_name = module.auth_authorizer_lambda.function_name
}
