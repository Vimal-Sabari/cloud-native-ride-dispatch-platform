/**
 * Lambda adapter entrypoint for SNS fanout notifications.
 *
 * Processes batches of SNSEvent records, parses the SNS message JSON,
 * and delegates to handleFanoutEvent.
 */

import { SNSEvent } from 'aws-lambda';
import { DynamoClient, DynamoAccessor } from '@ride-dispatch/dynamo-client';
import { ApiGatewayConnectionManager, ConnectionManager } from '../connection-manager';
import { handleFanoutEvent, FanoutMessage } from './sns-fanout';

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
const connectionManager = new ApiGatewayConnectionManager();

class FanoutDepsWrapper implements DynamoAccessor {
  constructor(
    private dynamo: DynamoClient,
    public connectionManager: ConnectionManager,
  ) {}

  getItem(pk: string, sk: string) {
    return this.dynamo.getItem(pk, sk);
  }
  putItem(item: Record<string, unknown>) {
    return this.dynamo.putItem(item);
  }
  deleteItem(pk: string, sk: string) {
    return this.dynamo.deleteItem(pk, sk);
  }
  query(options: Parameters<DynamoClient['query']>[0]) {
    return this.dynamo.query(options);
  }
  updateRide(rideId: string, updates: Parameters<DynamoClient['updateRide']>[1], cond?: string) {
    return this.dynamo.updateRide(rideId, updates, cond);
  }
  conditionalPutItem(item: Record<string, unknown>, cond: string) {
    return this.dynamo.conditionalPutItem(item, cond);
  }
}

const deps = new FanoutDepsWrapper(dynamoClient, connectionManager);

export const handler = async (event: SNSEvent): Promise<void> => {
  if (!event || !event.Records || !Array.isArray(event.Records)) {
    console.warn('SNSEvent contains no records');
    return;
  }

  for (const record of event.Records) {
    try {
      const rawMessage = record?.Sns?.Message;
      if (!rawMessage) {
        console.warn('Empty SNS Message encountered in record');
        continue;
      }

      let parsedMessage: FanoutMessage;
      try {
        parsedMessage = JSON.parse(rawMessage) as FanoutMessage;
      } catch (err) {
        console.error('Failed to parse SNS message as JSON', {
          error: err instanceof Error ? err.message : String(err),
          rawMessage,
        });
        continue;
      }

      await handleFanoutEvent(parsedMessage, deps);
    } catch (error) {
      console.error('Error handling fanout event for record', {
        recordId: record?.Sns?.MessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
};
