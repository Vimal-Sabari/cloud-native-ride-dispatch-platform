/**
 * WebSocket ConnectionManager implementation for Notification Service.
 *
 * Uses AWS SDK v3 ApiGatewayManagementApiClient and PostToConnectionCommand to
 * post real-time push notification payloads to active WebSocket connections.
 *
 * Endpoint Resolution:
 * Since SNS invocations do not include WebSocket request context, the endpoint
 * is configured via constructor parameter or via the WEBSOCKET_API_ENDPOINT / WEBSOCKET_ENDPOINT
 * environment variable (e.g., https://<api-id>.execute-api.<region>.amazonaws.com/<stage> or
 * http://localhost:4566 in LocalStack).
 */

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';

export interface ConnectionManager {
  postToConnection(
    connectionId: string,
    payload: Record<string, unknown>,
  ): Promise<{ stale: boolean }>;
}

export class ApiGatewayConnectionManager implements ConnectionManager {
  private client: ApiGatewayManagementApiClient;

  constructor(endpoint?: string) {
    const resolvedEndpoint =
      endpoint ||
      process.env.WEBSOCKET_API_ENDPOINT ||
      process.env.WEBSOCKET_ENDPOINT ||
      (process.env.LOCALSTACK_HOSTNAME ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566` : undefined);

    this.client = new ApiGatewayManagementApiClient({
      endpoint: resolvedEndpoint,
      region: process.env.AWS_REGION || 'us-east-1',
      ...(resolvedEndpoint && (resolvedEndpoint.includes('localhost') || resolvedEndpoint.includes('127.0.0.1'))
        ? {
            credentials: {
              accessKeyId: 'test',
              secretAccessKey: 'test',
            },
          }
        : {}),
    });
  }

  async postToConnection(
    connectionId: string,
    payload: Record<string, unknown>,
  ): Promise<{ stale: boolean }> {
    try {
      const command = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      });

      await this.client.send(command);
      return { stale: false };
    } catch (error: unknown) {
      if (
        error instanceof GoneException ||
        (error !== null &&
          typeof error === 'object' &&
          (('name' in error && (error as { name: string }).name === 'GoneException') ||
            ('$metadata' in error &&
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 410) ||
            ('statusCode' in error && (error as { statusCode: number }).statusCode === 410)))
      ) {
        return { stale: true };
      }
      throw error;
    }
  }
}
