#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Teardown AWS Development Environment (aws-dev)
# ==============================================================================
# WARNING: DESTRUCTIVE ACTION AGAINST REAL AWS CLOUD INFRASTRUCTURE!
#
# Running this script destroys ALL provisioned cloud resources in the aws-dev
# environment, including:
#   - Amazon DynamoDB single-table and secondary indexes
#   - Amazon SQS queues (location events, ride requests, DLQs)
#   - Amazon SNS topics (match events, ops alerts)
#   - AWS Lambda functions (Location, Trip, Notification, Auth, Event Forwarder)
#   - Amazon API Gateway REST and WebSocket APIs
#   - Amazon CloudWatch dashboard and metric alarms
#   - Amazon EC2 t2.micro instance and security groups for Matching Service
#
# RECOMMENDED PRACTICE:
# Execute this script between demos, load testing sessions, or development
# spikes to avoid ongoing AWS infrastructure costs (specifically EC2 running
# hours and data transfer charges).
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"

echo "======================================================================"
echo "WARNING: Initiating DESTRUCTIVE teardown of REAL AWS dev environment"
echo "Target: aws-dev (Terraform destroy with -var-file=aws-dev.tfvars)"
echo "======================================================================"

cd "$INFRA_DIR"
terraform destroy -var-file=aws-dev.tfvars -auto-approve

echo ""
echo "======================================================================"
echo "SUCCESS: aws-dev environment resources successfully destroyed."
echo "======================================================================"
