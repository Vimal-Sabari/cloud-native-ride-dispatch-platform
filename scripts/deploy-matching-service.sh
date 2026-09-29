#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Deploy Matching Service to EC2 (Real AWS Deployment Path)
# ==============================================================================
# NOTE: This script is intended for deployments against real AWS infrastructure
# (e.g. aws-dev environment, provisioned in Module 29).
# It is NOT used by local integration tests or CI, where LocalStack does not
# emulate genuine EC2 instance execution and Matching Service runs as a local
# background OS process.
#
# Workflow:
# 1. Build linux/amd64 binary via scripts/build-go-binary.sh.
# 2. Retrieve the EC2 instance public IP from Terraform outputs.
# 3. SCP binary and systemd service file (deploy/matching-service.service) to host.
# 4. SSH into instance, install binary to /opt/matching-service/, configure systemd,
#    and reload/restart the service.
#
# Module 29's continuous deployment pipeline will eventually automate this process.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH_KEY="${SSH_KEY:-~/.ssh/ride-dispatch-ec2.pem}"
SSH_USER="${SSH_USER:-ec2-user}"
INFRA_DIR="$ROOT_DIR/infra"

echo "=== Matching Service EC2 Deployment ==="

# Step 1: Query EC2 Public IP from Terraform outputs
cd "$INFRA_DIR"
if ! terraform output matching_service_public_ip >/dev/null 2>&1; then
  echo "Error: Could not retrieve matching_service_public_ip from terraform outputs."
  echo "Ensure 'terraform apply -var-file=aws-dev.tfvars' has succeeded."
  exit 1
fi

EC2_IP=$(terraform output -raw matching_service_public_ip)
if [ -z "$EC2_IP" ]; then
  echo "Error: matching_service_public_ip is empty. Ensure environment != 'local'."
  exit 1
fi
echo "Target EC2 Instance IP: $EC2_IP"
cd "$ROOT_DIR"

# Step 2: Build linux/amd64 binary
BIN_PATH="$ROOT_DIR/bin/matching-service"
echo "Building linux/amd64 binary..."
GOOS=linux GOARCH=amd64 bash "$ROOT_DIR/scripts/build-go-binary.sh" services/matching-service matching-service "$BIN_PATH"

# Step 3: Copy binary and systemd service definition to instance via SCP
echo "Uploading binary and systemd unit to EC2 host ($EC2_IP)..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BIN_PATH" "${SSH_USER}@${EC2_IP}:/tmp/matching-service"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ROOT_DIR/deploy/matching-service.service" "${SSH_USER}@${EC2_IP}:/tmp/matching-service.service"

# Step 4: Install and restart matching-service on EC2 host via SSH
echo "Installing binary and configuring systemd service on EC2 host..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${EC2_IP}" bash << 'EOF'
  set -euo pipefail
  echo "Creating application directory and user..."
  sudo useradd -r -s /sbin/nologin matching-service || true
  sudo mkdir -p /opt/matching-service /etc/matching-service
  sudo mv /tmp/matching-service /opt/matching-service/matching-service
  sudo chmod +x /opt/matching-service/matching-service
  sudo chown -R matching-service:matching-service /opt/matching-service

  echo "Installing systemd unit file..."
  sudo mv /tmp/matching-service.service /etc/systemd/system/matching-service.service
  sudo chown root:root /etc/systemd/system/matching-service.service
  sudo chmod 644 /etc/systemd/system/matching-service.service

  echo "Reloading systemd and restarting matching-service..."
  sudo systemctl daemon-reload
  sudo systemctl enable matching-service
  sudo systemctl restart matching-service
  sudo systemctl status matching-service --no-pager
EOF

echo "SUCCESS: Matching Service deployed and running on $EC2_IP."
