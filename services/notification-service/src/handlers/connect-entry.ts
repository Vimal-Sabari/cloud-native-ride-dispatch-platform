/**
 * Lambda adapter entrypoint for WebSocket $connect route.
 */

import { DynamoClient } from '@ride-dispatch/dynamo-client';
import { handleConnect } from './connect';

function getTableName(): string {
  return (
    process.env.TABLE_NAME ||
    process.env.RIDES_TABLE ||
    process.env.DYNAMO_TABLE_NAME ||
    'ride-dispatch-platform-local'
  );
}

function getEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) {
    return process.env.AWS_ENDPOINT_URL;
  }
  if (process.env.LOCALSTACK_HOSTNAME) {
    return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
  }
  return process.env.DYNAMO_ENDPOINT || undefined;
}

const dynamoClient = new DynamoClient(getTableName(), getEndpoint());

export interface WebSocketEvent {
  requestContext?: {
    connectionId?: string;
    routeKey?: string;
  };
  queryStringParameters?: Record<string, string | undefined> | null;
}

export interface WebSocketResult {
  statusCode: number;
  body?: string;
}

export const handler = async (event: WebSocketEvent): Promise<WebSocketResult> => {
  try {
    const connectionId = event.requestContext?.connectionId;
    if (!connectionId) {
      return { statusCode: 400, body: 'Missing connectionId in requestContext' };
    }

    const token = event.queryStringParameters?.token;
    const result = await handleConnect(connectionId, token, dynamoClient);
    return {
      statusCode: result.statusCode,
      body: result.statusCode === 200 ? 'Connected.' : 'Unauthorized.',
    };
  } catch (error) {
    console.error('connect handler failed', { error, event });
    return { statusCode: 500, body: 'Internal server error' };
  }
};
