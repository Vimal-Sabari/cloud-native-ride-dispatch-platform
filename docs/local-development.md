# Local Development Guide

This document outlines how to set up, start, test, and troubleshoot the local development and emulation environment for the Cloud-Native Ride Dispatch & Matching Platform.

---

## Prerequisites

Before running the local environment, ensure the following tooling is installed and accessible in your path:

- **Docker & Docker Compose**: Docker Desktop (v24+ / Compose v2+) running locally with Linux containers enabled.
- **AWS CLI**: AWS CLI v2 or `awscli` (Python package). Configured to connect to `http://localhost:4566`.
- **Go**: Version 1.22+ installed.
- **Node.js**: Version 20.x (managed via `.nvmrc` with nvm) and npm 10+.
- **Make & Bash**: GNU Make (`make` or `mingw32-make`) and a Bash-compatible shell (e.g. Git Bash).

---

## Environment Configuration

A template environment file [.env.example](file:///.env.example) is provided at the repository root. Copy it to create your local `.env`:

```bash
cp .env.example .env
```

Default variables configured for local emulation:
- `AWS_ENDPOINT=http://localhost:4566`
- `AWS_REGION=us-east-1`
- `AWS_ACCESS_KEY_ID=test`
- `AWS_SECRET_ACCESS_KEY=test`

---

## Starting the Local Environment (`make up`)

Start the containerized emulation suite by running:

```bash
make up
```

This target executes:
1. `docker compose up -d`: Launches the pinned LocalStack 3.8.1 container in detached mode with persistent volume storage (`localstack-data`) and mounted Docker socket.
2. `bash scripts/wait-for-localstack.sh`: Polls `http://localhost:4566/_localstack/health` every 2 seconds (up to 60s) until the DynamoDB service reports `available` or `running`.

To view streaming container logs at any time:
```bash
make logs
```

---

## Health Verification

You can directly query LocalStack's internal health endpoint using `curl`:

```bash
curl -s http://localhost:4566/_localstack/health | jq .
```

Expected response structure confirms the active services:
```json
{
  "services": {
    "dynamodb": "running",
    "lambda": "running",
    "sns": "running",
    "sqs": "running"
  }
}
```

---

## Running the Smoke Test

To verify that the AWS CLI can communicate with the local DynamoDB instance, create tables, query table states, and delete tables:

```bash
bash scripts/smoke-test-localstack.sh
```

The script exercises:
1. Creating a table `smoke-test-table` (`id` partition key).
2. Waiting for the table to become `ACTIVE`.
3. Verifying the table is present in `aws dynamodb list-tables`.
4. Deleting the table and exiting 0 upon success.

---

## Stopping the Environment (`make down`)

To stop LocalStack and remove associated networks and volumes:

```bash
make down
```

This ensures a clean, isolated state for subsequent runs.

---

## Lambda Runtimes in LocalStack

This LocalStack setup mounts `/var/run/docker.sock` to enable LocalStack's containerized Lambda execution executor. 

In subsequent modules, this single LocalStack instance will execute both:
- **Node.js-runtime Lambdas**: For Trip Service and Notification Service.
- **Custom-runtime (`provided.al2023`) Go Lambdas**: For Location Service, compiled as a Linux `bootstrap` binary.

No additional LocalStack services or plugins are required for this multi-runtime setup; the runtime differences are handled entirely during the build and packaging phase.

---

## Troubleshooting

### Docker Daemon Not Running
* **Symptom:** `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine...`
* **Resolution:** Ensure Docker Desktop is launched and the Docker engine status icon shows green/running in your taskbar.

### Port 4566 Conflicts
* **Symptom:** `Bind for 0.0.0.0:4566 failed: port is already allocated`
* **Resolution:** Check if another LocalStack instance or service is binding port 4566 (`netstat -ano | findstr 4566`) and terminate the conflicting process.

### Script Execution on Windows
* **Symptom:** `\r: command not found`
* **Resolution:** Shell scripts in `scripts/` must use LF line endings. Git checkout settings have been configured via `.editorconfig`. If needed, run:
  ```bash
  dos2unix scripts/*.sh
  ```
