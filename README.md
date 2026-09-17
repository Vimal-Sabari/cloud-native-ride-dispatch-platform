# Cloud-Native Ride Dispatch & Matching Platform

[![CI](https://github.com/Vimal-Sabari/cloud-native-ride-dispatch-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Vimal-Sabari/cloud-native-ride-dispatch-platform/actions/workflows/ci.yml)

## Overview
A high-throughput, cloud-native ride dispatch and matching backend platform built with an event-driven polyglot architecture on AWS.

## Architecture
See [docs/architecture.md](docs/architecture.md) and [docs/design-decisions.md](docs/design-decisions.md) for detailed architecture specifications and ADRs.

## Tech Stack
- **Go (1.22+)**: Location Service, Matching Service, and shared algorithmic/geospatial libraries (`shared/geospatial`, `shared/matching-algorithms`, `shared/models/go`, `shared/dynamo-client/go`).
- **TypeScript (Node 20.x)**: Trip Service, Notification Service, shared models/client (`shared/models/ts`, `shared/dynamo-client/ts`), and client simulators (`simulators/driver-simulator`, `simulators/rider-simulator`).
- **Infrastructure & Cloud**: AWS (Lambda, DynamoDB, SQS, SNS, API Gateway, EC2), LocalStack, Terraform.

## Local Setup
Local setup instructions using Docker Compose and LocalStack will be detailed in upcoming modules.

## Testing
Testing instructions across Go and TypeScript test suites will be detailed in upcoming modules.
