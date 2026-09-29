# ==============================================================================
# Matching Service EC2 Infrastructure Module
# ==============================================================================
# In production / AWS-dev environments (Module 29), Matching Service runs as a
# continuous daemon on a dedicated t2.micro EC2 instance.
#
# In local development and CI integration tests, LocalStack's Community tier does
# not emulate full EC2 virtualization. Per ADR "Local Testing Runs Matching
# Service as a Plain OS Process, Not Emulated EC2", all EC2 resources are guarded
# with count = var.environment == "local" ? 0 : 1, and the compiled Go binary
# runs directly as a background OS process against LocalStack endpoints.
# ==============================================================================

# Lookup latest Amazon Linux 2023 AMI when deploying to genuine AWS environments
data "aws_ami" "amazon_linux_2023" {
  count       = var.environment == "local" ? 0 : 1
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# IAM Role for EC2 Instance
resource "aws_iam_role" "matching_service" {
  count = var.environment == "local" ? 0 : 1
  name  = "${var.project_name}-${var.environment}-matching-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-${var.environment}-matching-service-role"
    Environment = var.environment
    Service     = "matching-service"
  }
}

# IAM Instance Profile wrapping the role
resource "aws_iam_instance_profile" "matching_service" {
  count = var.environment == "local" ? 0 : 1
  name  = "${var.project_name}-${var.environment}-matching-service-profile"
  role  = aws_iam_role.matching_service[0].name
}

# Narrowly-scoped IAM Policy: grants EXACTLY DynamoDB Get/Put, SQS Receive/Delete/GetAttributes, and CloudWatch logs.
# Broad managed policies (e.g. AdministratorAccess or AmazonDynamoDBFullAccess) are strictly prohibited.
resource "aws_iam_role_policy" "matching_service_policy" {
  count = var.environment == "local" ? 0 : 1
  name  = "${var.project_name}-${var.environment}-matching-service-policy"
  role  = aws_iam_role.matching_service[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem"
        ]
        Resource = var.dynamodb_table_arn
      },
      {
        Sid    = "SQSEventQueuesAccess"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = [
          var.location_events_queue_arn,
          var.ride_request_events_queue_arn
        ]
      },
      {
        Sid    = "CloudWatchLogsAccess"
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

# Egress-only security group: Matching Service only makes outbound calls to AWS APIs,
# SQS, and Trip Service's API Gateway endpoint; it never listens for inbound connections.
# If SSH debugging access is ever wanted, it should be added as a narrowly-scoped
# ingress rule restricted to a specific admin CIDR, not left open.
resource "aws_security_group" "matching_service" {
  count       = var.environment == "local" ? 0 : 1
  name        = "${var.project_name}-${var.environment}-matching-service-sg"
  description = "Egress-only security group for Matching Service daemon"

  egress {
    description = "Allow all outbound traffic to AWS services and API Gateway"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-matching-service-sg"
    Environment = var.environment
    Service     = "matching-service"
  }
}

# EC2 Instance for Matching Service daemon
resource "aws_instance" "matching_service" {
  count                = var.environment == "local" ? 0 : 1
  ami                  = var.ami_id != "" ? var.ami_id : data.aws_ami.amazon_linux_2023[0].id
  instance_type        = "t2.micro" # AWS Free Tier eligible
  iam_instance_profile = aws_iam_instance_profile.matching_service[0].name
  vpc_security_group_ids = [
    aws_security_group.matching_service[0].id
  ]

  # Minimal user_data script placeholder. In this project, code deployment uses the
  # scp-based deploy script (scripts/deploy-matching-service.sh) for simplicity and rapid
  # iteration over a more complex user_data/S3-artifact-pull mechanism at this project's scale.
  user_data = <<-EOF
              #!/bin/bash
              echo "Ride Dispatch Matching Service host initialized"
              EOF

  tags = {
    Name        = "${var.project_name}-${var.environment}-matching-service"
    Environment = var.environment
    Service     = "matching-service"
  }
}
