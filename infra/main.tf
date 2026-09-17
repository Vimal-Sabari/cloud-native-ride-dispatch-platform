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
}

module "dynamodb" {
  source = "./modules/dynamodb"
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
