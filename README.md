# Cloud-Native Ride Dispatch & Matching Platform

[![CI](https://github.com/Vimal-Sabari/cloud-native-ride-dispatch-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Vimal-Sabari/cloud-native-ride-dispatch-platform/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go Report Card](https://goreportcard.com/badge/github.com/Vimal-Sabari/cloud-native-ride-dispatch-platform)](https://goreportcard.com/report/github.com/Vimal-Sabari/cloud-native-ride-dispatch-platform)

A production-grade, event-driven ride dispatch platform built cloud-natively on AWS. It ingests high-frequency driver GPS telemetry, evaluates global bipartite matching across concurrent ride requests using a self-implemented Hungarian algorithm, enforces zero double-bookings under extreme supply contention through a two-phase claim-then-confirm protocol, and pushes real-time trip notifications over WebSockets—all engineered strictly within the AWS Free Tier.

---

## Architecture Overview

The platform adopts a decoupled, event-driven microservices architecture spanning five polyglot services coordinated asynchronously through Amazon DynamoDB Streams, Amazon SQS, and Amazon SNS:

```mermaid
flowchart TD
    subgraph Clients["Clients & Simulators"]
        DriverClient["Driver Simulator / Mobile App"]
        RiderClient["Rider Simulator / Mobile App"]
    end

    subgraph Ingestion["Amazon API Gateway (REST API)"]
        Authorizer["JWT Authorizer Lambda<br/>(services/auth-stub)"]
        APILoc["POST /drivers/{id}/location<br/>POST /drivers/{id}/status"]
        APITrip["POST /riders/{id}/rides<br/>GET /rides/{id}<br/>POST /rides/{id}/cancel"]
        APIInternal["POST /internal/rides/{id}/assign-driver<br/>(x-internal-api-key)"]
    end

    subgraph Services["Core Microservices"]
        LocationSvc["Location Service<br/>(Go / AWS Lambda)"]
        TripSvc["Trip Service<br/>(TypeScript / AWS Lambda)"]
        MatchingSvc["Matching Service Daemon<br/>(Go / Amazon EC2)"]
        Forwarder["Event Forwarder Lambda<br/>(Go / DynamoDB Streams)"]
        NotifSvc["Notification Service<br/>(TypeScript / WebSocket API)"]
    end

    subgraph Persistence["Storage & Messaging"]
        DDB[("Amazon DynamoDB<br/>Single Table + Streams")]
        LocQueue["SQS: location-events"]
        RideQueue["SQS: ride-request-events"]
        MatchSNS["SNS Topic: match-events"]
        WSAPIGW["API Gateway WebSocket API"]
    end

    %% Flow lines
    DriverClient -->|GPS Telemetry| APILoc --> LocationSvc -->|Write Heartbeat| DDB
    RiderClient -->|Request Trip| APITrip --> TripSvc -->|Create Trip (REQUESTED)| DDB
    Authorizer -.->|Validate JWT| APILoc
    Authorizer -.->|Validate JWT| APITrip

    DDB -->|Stream Shards| Forwarder
    Forwarder -->|location-updated| LocQueue --> MatchingSvc
    Forwarder -->|ride-requested| RideQueue --> MatchingSvc

    MatchingSvc -->|Phase 1: Atomic Claim| DDB
    MatchingSvc -->|Phase 2: Confirm Match| APIInternal --> TripSvc

    TripSvc -->|Publish ride-matched| MatchSNS --> NotifSvc
    NotifSvc -->|Push Socket Frame| WSAPIGW --> DriverClient
    WSAPIGW --> RiderClient
```

> For comprehensive service specifications, DynamoDB single-table schemas, secondary index roles (`GSI1`–`GSI4`), and failure handling semantics, see [**docs/architecture.md**](docs/architecture.md).

---

## Tech Stack

| Layer | Technologies & Services | Role in Platform |
| :--- | :--- | :--- |
| **Backend (Go 1.23+)** | Go, `zerolog`, `aws-sdk-go-v2` | • **Location Service:** Sub-10ms driver GPS ingestion Lambdas.<br/>• **Matching Service:** Long-running EC2 daemon with warm in-memory spatial index.<br/>• **Event Forwarder:** DynamoDB Streams $\rightarrow$ SQS batch router Lambda.<br/>• **Shared Libraries:** First-principles geospatial indexing (`shared/geospatial`) and Hungarian algorithm (`shared/matching-algorithms`). |
| **Backend (TypeScript / Node 20)** | TypeScript, Node.js 20, `pino`, `@aws-sdk` | • **Trip Service:** Ride state machine, cancellations, and internal assignment callbacks.<br/>• **Notification Service:** WebSocket `$connect` / `$disconnect` handlers and SNS fanout push.<br/>• **Auth Stub:** Role-scoped JWT token issuer and API Gateway Lambda authorizer.<br/>• **Client Simulators:** Standalone CLI driver and rider traffic generators. |
| **Cloud Infrastructure (AWS)** | Terraform (>= 1.7), LocalStack | • **Serverless Compute:** AWS Lambda (`provided.al2023`, `nodejs20.x`).<br/>• **APIs:** Amazon API Gateway (Regional REST API + WebSocket API v2).<br/>• **Datastore:** Amazon DynamoDB (Single-table design, On-Demand, Streams, TTL).<br/>• **Queuing & Events:** Amazon SQS (Queues + DLQs), Amazon SNS topics.<br/>• **Continuous Compute:** Amazon EC2 (`t2.micro` Linux instance with systemd).<br/>• **Observability & Scheduling:** Amazon CloudWatch (Dashboards, EMF metrics, DLQ alarms), Amazon EventBridge (stale-match reassignment). |
| **Performance Testing** | k6 (Go binary) | • High-throughput driver GPS load testing, burst ride requests, and concurrency contention validation. |

---

## Key Engineering Highlights

- **Self-Implemented Hungarian Algorithm ($O(n^3)$) with Brute-Force Mathematical Proof:**  
  Implemented the Kuhn-Munkres minimum-weight bipartite matching algorithm from first principles in Go with zero external dependencies, adding dynamic sentinel-cost padding for rectangular matrices ($N \ne M$). Verified against a permutation-enumeration reference solver across 100+ randomized matrices in [`shared/matching-algorithms/hungarian_test.go`](shared/matching-algorithms/hungarian_test.go), proving exact mathematical optimality within floating-point tolerance ($10^{-9}$).
- **Two-Phase Claim-Then-Confirm Protocol with Zero Double-Bookings:**  
  Solves distributed race conditions where concurrent matching threads or rider cancellations race for the same driver. Matching Service executes an atomic Compare-And-Swap (CAS) write on DynamoDB (`status = available -> busy`), confirms with Trip Service, and executes compensating rollbacks on failure. Verified via k6 stress testing under extreme supply contention (20 requests competing for 5 drivers in a 200m radius) with **0 double-bookings detected** ([`docs/load-testing-results.md`](docs/load-testing-results.md)).
- **Empirical A/B Benchmark: Batch Matching vs. Naive Nearest-Neighbor:**  
  Aggregates incoming ride requests in an in-memory 3-second / 20-request buffer to solve global multi-pair assignments rather than greedy first-come dispatch. Measured via structured match-decision telemetry ([`scripts/analyze-match-decisions.js`](scripts/analyze-match-decisions.js)):  
  - **+30% higher dispatch success rate** (80.0% batch vs. 50.0% naive).  
  - **25% reduction in deadhead pickup distance** (375 m batch vs. 500 m naive).  
  - Sub-28ms decision computation time.
- **Polyglot Event-Driven Decoupling:**  
  Five microservices across two runtimes (Go and TypeScript) connected asynchronously via DynamoDB Streams, SQS queues with Dead-Letter Queues, and SNS fan-out. Eliminates synchronous blocking on write paths, ensuring driver location updates and ride requests return in single-digit milliseconds.
- **Embedded Metric Format (EMF) Zero-Cost Observability:**  
  Emits operational and dispatch metrics (`MatchAttempted`, `MatchSucceeded`, `MatchDecisionDurationMs`) directly via stdout logs formatted in AWS CloudWatch EMF. CloudWatch asynchronously extracts custom metrics with zero outbound HTTP API calls and zero additional infrastructure costs.

---

## Local Development

The entire cloud architecture can be developed, executed, and tested offline without an AWS account using LocalStack and Docker Compose:

1. **Start the local environment:**
   ```bash
   cp .env.example .env
   make up
   ```
2. **Apply local Terraform infrastructure:**
   ```bash
   make infra-local-apply
   ```
3. **Execute local integration tests:**
   ```bash
   bash tests/integration/e2e-naive-flow-test.sh
   ```

For detailed prerequisites, port mappings, and troubleshooting steps, see the [**Local Development Guide**](docs/local-development.md).

---

## Deployment

Deployments to real AWS are fully automated via GitHub Actions in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

- **Manual Trigger Only (`workflow_dispatch`):** Real AWS infrastructure is never modified automatically on ordinary git pushes.
- **Human Approval Gate (`aws-dev-production`):** After services are compiled and packaged in CI, the deployment pauses until a designated reviewer clicks "Approve and deploy" in GitHub Settings > Environments.
- **Passwordless AWS OIDC:** Assumes temporary, short-lived IAM credentials via OpenID Connect, eliminating static AWS secret access keys in repository secrets.
- **Post-Deploy Smoke Test:** Automatically executes [`scripts/smoke-test-deployed.sh`](scripts/smoke-test-deployed.sh) against the live API Gateway endpoint to verify driver updates, ride creation, and authentication before marking the deployment successful.

For step-by-step setup instructions (S3 state backend, GitHub Environments, AWS IAM OIDC trust policy), see the [**Deployment Guide**](docs/deployment-guide.md).

---

## Testing

The repository enforces a rigorous four-layer testing pyramid:

```
                  ┌──────────────────────────────┐
                  │ Layer 4: Load & Stress (k6)  │
                  ├──────────────────────────────┤
                  │ Layer 3: End-to-End Workflows│
                  ├──────────────────────────────┤
                  │ Layer 2: Integration Tests   │
                  │ (LocalStack + AWS Services)  │
                  ├──────────────────────────────┤
                  │ Layer 1: Unit Tests (Go/Jest)│
                  │ (Zero Cloud Dependencies)    │
                  └──────────────────────────────┘
```

- **Unit Tests:** `go test ./...` and `npm test` across all packages (sub-second execution).
- **Integration Tests:** 12 automated bash test suites in `tests/integration/` validating DynamoDB schemas, streams forwarder, DLQs, Lambdas, and WebSocket connections.
- **Load & Stress Tests:** k6 test suites in `tests/load/` measuring continuous GPS telemetry throughput, ride request bursts, and zero double-booking concurrency invariants.

See [**Testing Strategy Documentation**](docs/testing-strategy.md) for full commands and test matrices.

---

## AWS Free Tier Cost-Consciousness

This project is engineered to operate strictly within the **AWS Free Tier**:

- **Serverless & On-Demand:** DynamoDB On-Demand, Lambda, SQS, SNS, and API Gateway incur **$0.00 idle cost** when traffic ceases.
- **EC2 `t2.micro` Management:** The Matching Service runs on a single `t2.micro` instance (covered by the 750 free hours/month allowance).
- **One-Command Teardown:** To avoid accidental charges between demo and evaluation sessions, tear down the environment anytime with:
  ```bash
  bash scripts/teardown-aws-dev.sh
  ```

For an itemized service-by-service Free Tier allowance breakdown and data transfer guidelines, see [**docs/cost-report.md**](docs/cost-report.md).

---

## Project Documentation Index

- [System Architecture](docs/architecture.md) — Service interaction diagrams, DynamoDB schema, and GSI roles.
- [Architecture Decision Records (ADRs)](docs/design-decisions.md) — Index of all 23 key engineering decisions.
- [Live Demo Script](docs/demo-script.md) — 5-minute step-by-step rehearsable presentation sequence.
- [Load Testing Results](docs/load-testing-results.md) — k6 benchmark numbers and double-booking verification.
- [AWS Deployment Guide](docs/deployment-guide.md) — OIDC configuration, GitHub Environment review gates, and rollback steps.
- [AWS Cost Report](docs/cost-report.md) — Itemized Free Tier analysis.
- [Local Development Guide](docs/local-development.md) — Docker Compose and LocalStack emulation instructions.
- [Testing Strategy](docs/testing-strategy.md) — Unit, integration, and E2E verification pyramid.
- [Idempotency & Concurrency Audit](docs/idempotency-audit.md) — Audit of all DynamoDB write paths.
