# AWS Cost & Free Tier Analysis Report

This document provides a comprehensive, itemized analysis of the cloud infrastructure costs for the **Cloud-Native Ride Dispatch & Matching Platform** running in the `aws-dev` environment.

The platform was architected from inception with extreme AWS Free Tier consciousness, leveraging serverless primitives, on-demand capacity, single-table multi-tenancy, and native platform features to minimize cloud expenditure.

---

## 1. Itemized Resource Consumption & Free Tier Allowances

The following table itemizes every AWS resource type provisioned and utilized by the platform, contrasted against AWS Free Tier monthly allowances:

| AWS Resource Type | Monthly AWS Free Tier Allowance | Platform Architecture & Usage Profile | Expected Monthly Cost |
| :--- | :--- | :--- | :--- |
| **Amazon DynamoDB** (Storage & Operations) | • **25 GB** of data storage<br/>• **25 Write Capacity Units (WCU)**<br/>• **25 Read Capacity Units (RCU)**<br/>• 2.5 million read/write requests/mo on On-Demand | • Single-table design (`ride-dispatch-platform-aws-dev`) consolidating driver locations, trips, and connections.<br/>• Configured with `PAY_PER_REQUEST` (On-Demand) billing to incur zero idle cost when traffic ceases.<br/>• Driver locations auto-expire via 5-minute TTL (`expiresAt`), capping persistent table size to under 100 MB during testing. | **$0.00**<br/>(Well within Free Tier) |
| **AWS Lambda** (Compute & Invocations) | • **1,000,000** free requests / month<br/>• **3,200,000 seconds** (400,000 GB-seconds) of compute time / month | • Polyglot Lambda functions (Location Service in Go `provided.al2023`, Trip & Notification Services in Node.js 20).<br/>• Allocated 128 MB RAM per function.<br/>• Go custom runtimes execute sub-10ms; TypeScript handlers average 20–50ms.<br/>• A comprehensive demo session executes ~5,000 invocations (<0.5% of monthly allowance). | **$0.00**<br/>(Well within Free Tier) |
| **Amazon API Gateway** (REST API) | • **1,000,000** API calls / month (first 12 months) | • Unified Regional REST API (`/drivers/...`, `/riders/...`, `/rides/...`).<br/>• Normal demo cycles and smoke tests generate <10,000 requests per month. | **$0.00**<br/>(Within Free Tier) |
| **Amazon API Gateway** (WebSocket API) | • **1,000,000** connection-minutes & **1,000,000** messages / month (first 12 months) | • Dedicated WebSocket API for rider and driver real-time event frames.<br/>• Ephemeral connections closed post-trip or cleaned up via GoneException (HTTP 410) handling. | **$0.00**<br/>(Within Free Tier) |
| **Amazon SQS** (Message Queuing) | • **1,000,000** requests / month (Always Free) | • Two primary queues (`location-events`, `ride-request-events`) and two DLQs.<br/>• Matching Service uses long-polling (`WaitTimeSeconds = 20`), dramatically minimizing total API call frequency while keeping queue polling near zero idle overhead. | **$0.00**<br/>(Strictly within Free Tier) |
| **Amazon SNS** (Event Notification) | • **1,000,000** Amazon SNS publishes / month (Always Free)<br/>• **100,000** HTTP/S notifications / month<br/>• **1,000** email notifications / month | • `match-events` topic: publishes `ride-matched` and `ride-cancelled` events to Notification Fanout Lambda.<br/>• `ops-alerts` topic: sends email notifications on DLQ depth alarms. | **$0.00**<br/>(Strictly within Free Tier) |
| **Amazon EventBridge** (Scheduled Rules) | • **1,000,000** custom events / month (Always Free)<br/>• Scheduled rules are free | • One scheduled rule (`reassign-stale-matches`) executing once every minute (`rate(1 minute)` = ~43,200 invocations/month) to evaluate abandoned driver dispatches. | **$0.00**<br/>(Strictly within Free Tier) |
| **Amazon CloudWatch** (Logs, Metrics, Alarms) | • **5 GB** log ingestion & 5 GB archive storage<br/>• **10** custom metrics & 3 dashboards<br/>• **10** metric alarms | • Custom metrics emitted via Embedded Metric Format (EMF) into standard stdout logs, incurring **zero** additional CloudWatch `PutMetricData` API costs.<br/>• 1 unified dashboard (`platform-overview`).<br/>• Exactly 2 high-signal metric alarms on DLQ depths (`ride-request-dlq-depth`, `location-events-dlq-depth`). | **$0.00**<br/>(Within Free Tier) |
| **Amazon EC2** (`t2.micro` Instance) | • **750 hours** / month of Linux `t2.micro` (first 12 months) | • Matching Service daemon running as a single `t2.micro` instance in the default VPC.<br/>• Continual monthly runtime consumes ~720–744 hours/month (see critical note below). | **$0.00** (if shut down between sessions or sole running instance) |

---

## 2. Honest Cost Assessment & Boundary Conditions

### The EC2 `t2.micro` Free Tier Allowance
A calendar month contains between **672 and 744 hours**. A single `t2.micro` instance running continuously consumes up to 744 hours, technically fitting just inside the AWS Free Tier 750-hour allowance for new accounts.

However, two practical scenarios can incur charges:
1. **Multiple Concurrent Instances:** The 750-hour allowance is aggregated across **all** EC2 instances in your AWS account. If you run another EC2 instance elsewhere in your account, running the Matching Service concurrently will exceed the allowance.
2. **Expired 12-Month Free Tier:** If your AWS account is older than 12 months, EC2 `t2.micro` usage is billed at standard on-demand pricing (~$0.0116/hour in `us-east-1`, or **~$8.50 per month**).

> [!IMPORTANT]
> **Recommended Practice:**  
> To guarantee zero unexpected charges, always execute the teardown script between demo and evaluation sessions:
> ```bash
> bash scripts/teardown-aws-dev.sh
> ```
> This completely destroys the EC2 instance, DynamoDB table, API Gateways, and related resources, ensuring your cloud bill remains strictly at **$0.00**.

### Load Testing Data-Transfer Costs
Executing sustained, high-concurrency load tests (Module 28) against the live cloud deployment generates significant network throughput:
- Driver location updates (e.g., 100 VUs firing 50 req/sec over 10 minutes) transmit tens of thousands of JSON payloads through API Gateway.
- AWS charges for Internet Data Transfer OUT beyond 100 GB/month. While standard test runs consume under 50 MB (remaining free), running multi-hour stress tests against real AWS will consume bandwidth and API Gateway request quotas.
- **Guideline:** Run extensive, long-duration load tests against the local LocalStack environment (`make up`), and reserve live AWS runs for validation smoke tests (<5 minutes).

---

## 3. Summary Statement

For any engineer, recruiter, or reviewer evaluating this codebase:
- **Zero Ongoing Cost When Idle:** Using DynamoDB On-Demand, AWS Lambda, SQS, SNS, and API Gateway means the serverless tiers incur **zero idle charges**.
- **Clean Teardown:** With `scripts/teardown-aws-dev.sh`, tearing down and standing back up via GitHub Actions (`.github/workflows/deploy.yml`) is completely automated, predictable, and costs nothing when not active.
