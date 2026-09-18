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
      dynamodb   = "http://localhost:4566"
      ec2        = "http://localhost:4566"
      lambda     = "http://localhost:4566"
      s3         = "http://localhost:4566"
      sns        = "http://localhost:4566"
      sqs        = "http://localhost:4566"
    }
  }

  access_key                  = var.environment == "local" ? "mock_access_key" : null
  secret_key                  = var.environment == "local" ? "mock_secret_key" : null
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

module "lambda" {
  source = "./modules/lambda"
}

module "ec2_matching" {
  source = "./modules/ec2-matching"
}

module "api_gateway" {
  source = "./modules/api-gateway"
}
