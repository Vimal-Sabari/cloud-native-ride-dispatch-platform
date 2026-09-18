import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

export interface QueryInput {
  indexName?: string;
  keyConditionExpression: string;
  expressionAttributeValues: Record<string, unknown>;
  filterExpression?: string;
}

export class DynamoClient {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, endpoint?: string) {
    this.tableName = tableName;

    let ddbClient: DynamoDBClient;
    if (endpoint) {
      ddbClient = new DynamoDBClient({
        endpoint,
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test',
          secretAccessKey: 'test',
        },
      });
    } else {
      ddbClient = new DynamoDBClient({});
    }

    this.docClient = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  async getItem(pk: string, sk: string): Promise<Record<string, unknown> | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: pk,
          SK: sk,
        },
      }),
    );

    return (response.Item as Record<string, unknown>) ?? null;
  }

  async putItem(item: Record<string, unknown>): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );
  }

  async query(input: QueryInput): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const response = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: input.indexName,
          KeyConditionExpression: input.keyConditionExpression,
          ExpressionAttributeValues: input.expressionAttributeValues,
          FilterExpression: input.filterExpression,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      if (response.Items) {
        items.push(...(response.Items as Record<string, unknown>[]));
      }

      lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items;
  }

  async conditionalPutItem(
    item: Record<string, unknown>,
    conditionExpression: string,
  ): Promise<boolean> {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: conditionExpression,
        }),
      );
      return true;
    } catch (err: unknown) {
      if (
        err !== null &&
        typeof err === 'object' &&
        (('name' in err && (err as { name: string }).name === 'ConditionalCheckFailedException') ||
          ('__type' in err &&
            (err as { __type: string }).__type.endsWith('ConditionalCheckFailedException')))
      ) {
        return false;
      }
      throw err;
    }
  }
}
