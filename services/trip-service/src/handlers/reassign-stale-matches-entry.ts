/**
 * Lambda entrypoint adapter for reassign-stale-matches.
 *
 * Invocation Models & Security:
 * 1. EventBridge Rule (Scheduled Target):
 *    Triggered periodically (e.g. rate(30 seconds)) by CloudWatch Events / EventBridge.
 *    No HTTP layer or API keys are required for this path; invocation authorization is governed
 *    directly by AWS IAM (aws_lambda_permission granting events.amazonaws.com invoke rights).
 * 2. Direct Lambda Invoke (Integration Tests / Ops tooling):
 *    Invoked via `aws lambda invoke`. Runs identically to the scheduled invocation.
 * 3. API Gateway / HTTP Proxy (Optional / Management):
 *    If invoked via an HTTP proxy event with headers, the request validates the `x-internal-api-key`
 *    header against process.env.INTERNAL_API_KEY.
 */

import { DynamoClient } from '@ride-dispatch/dynamo-client';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { reassignStaleMatches, SqsSender } from './reassign-stale-matches';

function getTableName(): string {
  const table = process.env.RIDES_TABLE || process.env.DYNAMO_TABLE_NAME || process.env.TABLE_NAME;
  if (!table) {
    if (process.env.NODE_ENV === 'test') {
      return 'ride-dispatch-platform-local';
    }
    throw new Error('RIDES_TABLE is not configured');
  }
  return table;
}

function getDynamoEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  if (process.env.LOCALSTACK_HOSTNAME) return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
  return process.env.DYNAMO_ENDPOINT || undefined;
}

function getSqsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  if (process.env.LOCALSTACK_HOSTNAME) return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
  return process.env.SQS_ENDPOINT || undefined;
}

const dynamoClient = new DynamoClient(getTableName(), getDynamoEndpoint());

const sqsEndpoint = getSqsEndpoint();
const sqsClient = new SQSClient({
  endpoint: sqsEndpoint,
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

const sqsSender: SqsSender = {
  async sendMessage(queueUrl: string, messageBody: string): Promise<unknown> {
    return sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
      }),
    );
  },
};

interface LambdaScheduledEvent {
  source?: string;
  'detail-type'?: string;
  time?: string;
  headers?: Record<string, string | undefined>;
}

export const handler = async (
  event?: LambdaScheduledEvent,
): Promise<{ statusCode: number; body: string }> => {
  // Check optional HTTP authorization if called via API Gateway
  if (event && event.headers) {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey) {
      const apiKey = Object.entries(event.headers).find(
        ([k]) => k.toLowerCase() === 'x-internal-api-key',
      )?.[1];
      if (!apiKey || apiKey.trim() !== expectedKey) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: 'Unauthorized: invalid or missing internal API key' }),
        };
      }
    }
  }

  const rawTimeout = process.env.DRIVER_ACCEPT_TIMEOUT_SECONDS;
  const timeoutSeconds = rawTimeout ? parseInt(rawTimeout, 10) : 60;
  const queueUrl = process.env.RIDE_REQUEST_EVENTS_QUEUE_URL || '';

  try {
    const result = await reassignStaleMatches(timeoutSeconds, dynamoClient, sqsSender, queueUrl);

    console.info('[reassign-stale-matches-entry] Execution completed:', {
      reassignedCount: result.reassignedCount,
      rideIds: result.rideIds,
      timeoutSeconds,
    });

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('[reassign-stale-matches-entry] Execution failed:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to reassign stale matches',
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
