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
      apigateway   = "http://localhost:4566"
      apigatewayv2 = "http://localhost:4566"
      cloudwatch   = "http://localhost:4566"
      dynamodb     = "http://localhost:4566"
      ec2          = "http://localhost:4566"
      iam          = "http://localhost:4566"
      lambda       = "http://localhost:4566"
      logs         = "http://localhost:4566"
      s3           = "http://localhost:4566"
      sns          = "http://localhost:4566"
      sqs          = "http://localhost:4566"
      sts          = "http://localhost:4566"
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
  source       = "./modules/sqs-sns"
  environment  = var.environment
  project_name = var.project_name
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
    JWT_SECRET        = "dev-jwt-secret-for-ride-dispatch-local-testing"
    DENY_UNAUTHORIZED = "true"
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
    DYNAMODB_TABLE      = module.dynamodb.table_name
    TABLE_NAME          = module.dynamodb.table_name
    DYNAMO_TABLE_NAME   = module.dynamodb.table_name
    AWS_REGION          = var.aws_region
    AWS_ENDPOINT_URL    = var.environment == "local" ? "http://localstack:4566" : ""
    LOCALSTACK_ENDPOINT = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT     = var.environment == "local" ? "http://localstack:4566" : ""
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
    DYNAMODB_TABLE      = module.dynamodb.table_name
    TABLE_NAME          = module.dynamodb.table_name
    DYNAMO_TABLE_NAME   = module.dynamodb.table_name
    AWS_REGION          = var.aws_region
    AWS_ENDPOINT_URL    = var.environment == "local" ? "http://localstack:4566" : ""
    LOCALSTACK_ENDPOINT = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT     = var.environment == "local" ? "http://localstack:4566" : ""
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
    TABLE_NAME        = module.dynamodb.table_name
    AWS_REGION        = var.aws_region
    AWS_ENDPOINT_URL  = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localstack:4566" : ""
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
    TABLE_NAME        = module.dynamodb.table_name
    AWS_REGION        = var.aws_region
    AWS_ENDPOINT_URL  = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localstack:4566" : ""
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
    DYNAMO_TABLE_NAME      = module.dynamodb.table_name
    RIDES_TABLE            = module.dynamodb.table_name
    TABLE_NAME             = module.dynamodb.table_name
    AWS_REGION             = var.aws_region
    AWS_ENDPOINT_URL       = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT        = var.environment == "local" ? "http://localstack:4566" : ""
    MATCH_EVENTS_TOPIC_ARN = module.sqs_sns.match_events_topic_arn
    SNS_ENDPOINT           = var.environment == "local" ? "http://localstack:4566" : ""
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
    TABLE_NAME        = module.dynamodb.table_name
    AWS_REGION        = var.aws_region
    AWS_ENDPOINT_URL  = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localstack:4566" : ""
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
    DYNAMO_TABLE_NAME      = module.dynamodb.table_name
    RIDES_TABLE            = module.dynamodb.table_name
    TABLE_NAME             = module.dynamodb.table_name
    AWS_REGION             = var.aws_region
    AWS_ENDPOINT_URL       = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT        = var.environment == "local" ? "http://localstack:4566" : ""
    INTERNAL_API_KEY       = var.internal_api_key
    MATCH_EVENTS_TOPIC_ARN = module.sqs_sns.match_events_topic_arn
    SNS_ENDPOINT           = var.environment == "local" ? "http://localstack:4566" : ""
  }
}

# Grant Trip Service Lambdas permissions to publish to match-events SNS topic
resource "aws_iam_role_policy" "trip_sns_publish_policy" {
  for_each = {
    cancel_ride   = module.trip_cancel_ride_lambda.role_name
    assign_driver = module.trip_assign_driver_lambda.role_name
  }

  name = "${var.project_name}-${var.environment}-trip-${each.key}-sns-publish"
  role = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = module.sqs_sns.match_events_topic_arn
      }
    ]
  })
}


# Dedicated IAM policy for Event Forwarder Lambda:
# Grants permissions to read DynamoDB Streams and send messages to destination SQS queues
resource "aws_iam_role_policy" "event_forwarder_policy" {
  name = "${var.project_name}-${var.environment}-event-forwarder-policy"
  role = module.event_forwarder_lambda.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams"
        ]
        Resource = module.dynamodb.stream_arn
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = [
          module.sqs_sns.location_events_queue_arn,
          module.sqs_sns.ride_request_events_queue_arn
        ]
      }
    ]
  })
}

# Module 16 DynamoDB Streams to SQS Event Forwarder Lambda (Go custom runtime)
module "event_forwarder_lambda" {
  source                      = "./modules/lambda"
  runtime                     = "provided.al2023"
  handler                     = "bootstrap"
  artifact_path               = "${path.module}/../services/event-forwarder/event-forwarder.zip"
  function_name               = "${var.project_name}-${var.environment}-event-forwarder"
  enable_event_source_mapping = true
  event_source_arn            = module.dynamodb.stream_arn
  depends_on_resources        = [aws_iam_role_policy.event_forwarder_policy]
  timeout                     = 10
  memory_size                 = 128

  environment_variables = {
    LOCATION_EVENTS_QUEUE_URL     = module.sqs_sns.location_events_queue_url
    RIDE_REQUEST_EVENTS_QUEUE_URL = module.sqs_sns.ride_request_events_queue_url
    AWS_ENDPOINT_URL              = var.environment == "local" ? "http://localstack:4566" : ""
    AWS_REGION                    = var.aws_region
  }
}


module "ec2_matching" {
  source                        = "./modules/ec2-matching"
  project_name                  = var.project_name
  environment                   = var.environment
  dynamodb_table_arn            = module.dynamodb.table_arn
  location_events_queue_arn     = module.sqs_sns.location_events_queue_arn
  ride_request_events_queue_arn = module.sqs_sns.ride_request_events_queue_arn
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

# ------------------------------------------------------------------------------
# Notification Service Lambdas & WebSocket API (TypeScript / Node.js 20.x runtime)
# ------------------------------------------------------------------------------

# Notification Service - Connect Lambda
module "notification_connect_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.handler"
  artifact_path          = "${path.module}/../services/notification-service/connect.zip"
  function_name          = "${var.project_name}-${var.environment}-notification-connect"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    RIDES_TABLE       = module.dynamodb.table_name
    TABLE_NAME        = module.dynamodb.table_name
    AWS_REGION        = var.aws_region
    AWS_ENDPOINT_URL  = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localstack:4566" : ""
    JWT_SECRET        = "dev-jwt-secret-for-ride-dispatch-local-testing"
  }
}

# Notification Service - Disconnect Lambda
module "notification_disconnect_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.handler"
  artifact_path          = "${path.module}/../services/notification-service/disconnect.zip"
  function_name          = "${var.project_name}-${var.environment}-notification-disconnect"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 10
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME = module.dynamodb.table_name
    RIDES_TABLE       = module.dynamodb.table_name
    TABLE_NAME        = module.dynamodb.table_name
    AWS_REGION        = var.aws_region
    AWS_ENDPOINT_URL  = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT   = var.environment == "local" ? "http://localstack:4566" : ""
  }
}

# Notification Service - Fanout Lambda
module "notification_fanout_lambda" {
  source                 = "./modules/lambda"
  runtime                = "nodejs20.x"
  handler                = "index.fanoutHandler"
  artifact_path          = "${path.module}/../services/notification-service/fanout.zip"
  function_name          = "${var.project_name}-${var.environment}-notification-fanout"
  enable_dynamodb_access = true
  dynamodb_table_arn     = module.dynamodb.table_arn
  timeout                = 15
  memory_size            = 128

  environment_variables = {
    DYNAMO_TABLE_NAME      = module.dynamodb.table_name
    RIDES_TABLE            = module.dynamodb.table_name
    TABLE_NAME             = module.dynamodb.table_name
    AWS_REGION             = var.aws_region
    AWS_ENDPOINT_URL       = var.environment == "local" ? "http://localstack:4566" : ""
    DYNAMO_ENDPOINT        = var.environment == "local" ? "http://localstack:4566" : ""
    SNS_ENDPOINT           = var.environment == "local" ? "http://localstack:4566" : ""
    WEBSOCKET_API_ENDPOINT = var.environment == "local" ? "http://localstack:4566" : ""
  }
}

# Notification Service - WebSocket API Gateway
# Note on LocalStack Community tier:
# API Gateway v2 (WebSocket APIs: aws_apigatewayv2_api) is unsupported in LocalStack
# Community edition (returns 501 Not Implemented). Per project design decisions,
# when use_localstack is true or environment == "local", WebSocket API Gateway resources are skipped.
module "websocket_api" {
  count                           = var.use_localstack || var.environment == "local" ? 0 : 1
  source                          = "./modules/websocket-api"
  project_name                    = var.project_name
  environment                     = var.environment
  connect_lambda_invoke_arn       = module.notification_connect_lambda.invoke_arn
  connect_lambda_function_name    = module.notification_connect_lambda.function_name
  disconnect_lambda_invoke_arn    = module.notification_disconnect_lambda.invoke_arn
  disconnect_lambda_function_name = module.notification_disconnect_lambda.function_name
  match_events_topic_arn          = module.sqs_sns.match_events_topic_arn
  fanout_lambda_arn               = module.notification_fanout_lambda.function_arn
  fanout_lambda_function_name     = module.notification_fanout_lambda.function_name
  fanout_lambda_role_name         = module.notification_fanout_lambda.role_name
  dynamodb_table_arn              = module.dynamodb.table_arn
}

# In LocalStack Community environments where websocket_api module is skipped due to APIGatewayV2 limitation,
# provision the SNS topic subscription and Lambda invoke permission directly so SNS fan-out works in LocalStack.
resource "aws_sns_topic_subscription" "localstack_fanout" {
  count     = var.use_localstack || var.environment == "local" ? 1 : 0
  topic_arn = module.sqs_sns.match_events_topic_arn
  protocol  = "lambda"
  endpoint  = module.notification_fanout_lambda.function_arn
}

resource "aws_lambda_permission" "localstack_sns_invoke_fanout" {
  count         = var.use_localstack || var.environment == "local" ? 1 : 0
  statement_id  = "AllowExecutionFromSNSMatchEventsLocal"
  action        = "lambda:InvokeFunction"
  function_name = module.notification_fanout_lambda.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = module.sqs_sns.match_events_topic_arn
}

# ------------------------------------------------------------------------------
# Module 26: Observability (Alarms, SNS Alerts, and CloudWatch Dashboard)
# ------------------------------------------------------------------------------

module "observability" {
  source                     = "./modules/observability"
  project_name               = var.project_name
  environment                = var.environment
  aws_region                 = var.aws_region
  ops_alert_email            = var.ops_alert_email
  ride_request_dlq_arn       = module.sqs_sns.ride_request_events_dlq_arn
  ride_request_dlq_name      = module.sqs_sns.ride_request_events_dlq_name
  location_events_dlq_arn    = module.sqs_sns.location_events_dlq_arn
  location_events_dlq_name   = module.sqs_sns.location_events_dlq_name
  ride_request_queue_name    = module.sqs_sns.ride_request_events_queue_name
  location_events_queue_name = module.sqs_sns.location_events_queue_name
  dynamodb_table_name        = module.dynamodb.table_name

  lambda_function_names = [
    module.location_update_location_lambda.function_name,
    module.location_update_status_lambda.function_name,
    module.auth_authorizer_lambda.function_name,
    module.trip_request_ride_lambda.function_name,
    module.trip_get_ride_lambda.function_name,
    module.trip_cancel_ride_lambda.function_name,
    module.trip_list_rider_rides_lambda.function_name,
    module.trip_assign_driver_lambda.function_name,
    module.notification_connect_lambda.function_name,
    module.notification_disconnect_lambda.function_name,
    module.notification_fanout_lambda.function_name,
    module.event_forwarder_lambda.function_name
  ]
}



