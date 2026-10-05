#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SQS Dead Letter Queue (DLQ) Redrive Script
# ==============================================================================
# Usage:
#   scripts/redrive-dlq.sh <dlq-queue-url> <source-queue-url>
#
# Description:
#   Pulls messages from the specified DLQ in batches of up to 10 and moves them
#   back to the primary source queue. Messages are deleted from the DLQ only
#   AFTER the send to the source queue has been confirmed successful, preventing
#   message loss in the event of partial failures.
#
# Architectural Note:
#   AWS SQS provides a native "Start Message Move Task" API (StartMessageMoveTask)
#   which operates asynchronously on the server side. While suitable for high-volume
#   production workloads on AWS, this lightweight CLI script is used here to ensure
#   seamless portability between LocalStack (where StartMessageMoveTask is not
#   consistently implemented across versions) and real AWS environments, while
#   providing immediate, synchronous feedback and auditability.
# ==============================================================================

if [ "$#" -lt 2 ]; then
  echo "Error: Missing arguments."
  echo "Usage: $0 <dlq-queue-url> <source-queue-url>"
  exit 1
fi

DLQ_URL="$1"
SOURCE_URL="$2"
REGION="${AWS_REGION:-us-east-1}"

# Support LocalStack or custom AWS endpoints via environment variable
AWS_CLI_ARGS=(--region "$REGION")
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
  AWS_CLI_ARGS+=(--endpoint-url "$AWS_ENDPOINT_URL")
elif [ -n "${ENDPOINT_URL:-}" ]; then
  AWS_CLI_ARGS+=(--endpoint-url "$ENDPOINT_URL")
fi

echo "========================================================"
echo "Starting SQS DLQ Redrive"
echo "DLQ Source:   $DLQ_URL"
echo "Target Queue: $SOURCE_URL"
echo "Region:       $REGION"
echo "========================================================"

TOTAL_REDRIVEN=0
BATCH_NUMBER=1

while true; do
  echo "Batch $BATCH_NUMBER: Polling up to 10 messages from DLQ..."

  # Receive up to 10 messages with 1-second wait
  RECEIVE_OUTPUT=$(aws sqs receive-message \
    --queue-url "$DLQ_URL" \
    --max-number-of-messages 10 \
    --visibility-timeout 30 \
    --wait-time-seconds 1 \
    "${AWS_CLI_ARGS[@]}" \
    --output json 2>/dev/null || echo "{}")

  MESSAGES_COUNT=$(echo "$RECEIVE_OUTPUT" | jq -r '.Messages | length // 0')

  if [ "$MESSAGES_COUNT" -eq 0 ]; then
    echo "No more messages found in DLQ."
    break
  fi

  echo "Received $MESSAGES_COUNT message(s) in batch $BATCH_NUMBER."

  for i in $(seq 0 $((MESSAGES_COUNT - 1))); do
    MSG=$(echo "$RECEIVE_OUTPUT" | jq -r ".Messages[$i]")
    RECEIPT_HANDLE=$(echo "$MSG" | jq -r '.ReceiptHandle')
    BODY=$(echo "$MSG" | jq -r '.Body')
    MSG_ID=$(echo "$MSG" | jq -r '.MessageId')

    # Step 1: Send message to source queue
    SEND_RESP=$(aws sqs send-message \
      --queue-url "$SOURCE_URL" \
      --message-body "$BODY" \
      "${AWS_CLI_ARGS[@]}" \
      --output json)

    NEW_MSG_ID=$(echo "$SEND_RESP" | jq -r '.MessageId // empty')
    if [ -z "$NEW_MSG_ID" ]; then
      echo "ERROR: Failed to redrive message $MSG_ID to target queue. Aborting batch."
      exit 1
    fi

    # Step 2: Delete message from DLQ only after send confirms
    aws sqs delete-message \
      --queue-url "$DLQ_URL" \
      --receipt-handle "$RECEIPT_HANDLE" \
      "${AWS_CLI_ARGS[@]}"

    TOTAL_REDRIVEN=$((TOTAL_REDRIVEN + 1))
    echo "  [Redriven] Old ID: $MSG_ID -> New ID: $NEW_MSG_ID (Total redriven: $TOTAL_REDRIVEN)"
  done

  BATCH_NUMBER=$((BATCH_NUMBER + 1))
done

echo ""
echo "========================================================"
echo "Redrive Complete!"
echo "Total messages successfully redriven: $TOTAL_REDRIVEN"
echo "========================================================"
