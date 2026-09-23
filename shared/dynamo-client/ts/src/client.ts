import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export interface QueryInput {
  indexName?: string;
  keyConditionExpression: string;
  expressionAttributeValues: Record<string, unknown>;
  filterExpression?: string;
}

export interface UpdateRideValues {
  state?: string;
  driverId?: string;
}

export function isConditionalCheckFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  return (
    err.name === 'ConditionalCheckFailedException' ||
    (typeof err.__type === 'string' && err.__type.endsWith('ConditionalCheckFailedException')) ||
    err.code === 'ConditionalCheckFailedException' ||
    err.Code === 'ConditionalCheckFailedException'
  );
}

function resolveEndpoint(endpoint?: string): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) {
    return process.env.AWS_ENDPOINT_URL;
  }
  if (process.env.LOCALSTACK_HOSTNAME) {
    return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
  }
  if (endpoint && endpoint.trim() !== '') {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME && endpoint.includes('localhost') && process.env.LOCALSTACK_HOSTNAME) {
      return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
    }
    return endpoint;
  }
  return undefined;
}

export class DynamoClient {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, endpoint?: string) {
    this.tableName = tableName;

    const resolvedEndpoint = resolveEndpoint(endpoint);
    let ddbClient: DynamoDBClient;
    if (resolvedEndpoint) {
      ddbClient = new DynamoDBClient({
        endpoint: resolvedEndpoint,
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      });
    } else {
      ddbClient = new DynamoDBClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });
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

  async updateRide(
    rideId: string,
    values: UpdateRideValues,
    condition?: string,
    extraExpressionValues?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const cleanRideId = rideId.startsWith('RIDE#') ? rideId.slice(5) : rideId;
    const pk = `RIDE#${cleanRideId}`;
    const sk = 'DETAILS';

    const names: Record<string, string> = {
      '#updatedAt': 'updatedAt',
    };
    const expressionValues: Record<string, unknown> = {
      ':updatedAt': new Date().toISOString(),
    };
    const assignments: string[] = ['#updatedAt = :updatedAt'];

    if (values.state !== undefined) {
      names['#state'] = 'state';
      expressionValues[':state'] = values.state;
      assignments.push('#state = :state');
    }

    if (values.driverId !== undefined) {
      names['#driverId'] = 'driverId';
      expressionValues[':driverId'] = values.driverId;
      assignments.push('#driverId = :driverId');
    }

    if (condition) {
      if (condition.includes('#state')) {
        names['#state'] = 'state';
      }
      if (condition.includes(':requested') && expressionValues[':requested'] === undefined) {
        expressionValues[':requested'] = 'REQUESTED';
      }
      if (condition.includes(':matched') && expressionValues[':matched'] === undefined) {
        expressionValues[':matched'] = 'MATCHED';
      }
      if (condition.includes(':driver_en_route') && expressionValues[':driver_en_route'] === undefined) {
        expressionValues[':driver_en_route'] = 'DRIVER_EN_ROUTE';
      }
      if (condition.includes('#riderId')) {
        names['#riderId'] = 'riderId';
      }
    }

    if (extraExpressionValues) {
      Object.assign(expressionValues, extraExpressionValues);
    }

    const combinedExpressions = `${assignments.join(' ')} ${condition || ''}`;

    const cleanNames: Record<string, string> = {};
    for (const [k, v] of Object.entries(names)) {
      if (combinedExpressions.includes(k)) {
        cleanNames[k] = v;
      }
    }

    const cleanValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(expressionValues)) {
      if (combinedExpressions.includes(k)) {
        cleanValues[k] = v;
      }
    }

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        PK: pk,
        SK: sk,
      },
      UpdateExpression: `SET ${assignments.join(', ')}`,
      ...(Object.keys(cleanNames).length > 0 ? { ExpressionAttributeNames: cleanNames } : {}),
      ...(Object.keys(cleanValues).length > 0 ? { ExpressionAttributeValues: cleanValues } : {}),
      ...(condition && condition.trim() !== '' ? { ConditionExpression: condition } : {}),
      ReturnValues: 'ALL_NEW',
    });

    const response = await this.docClient.send(command);
    return (response.Attributes as Record<string, unknown>) ?? {};
  }

  async conditionalPutItem(
    item: Record<string, unknown>,
    conditionExpression: string,
  ): Promise<boolean> {
    try {
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      let expr = conditionExpression;

      const stateMatch = expr.match(/state\s*=\s*([A-Za-z0-9_]+)/);
      if (stateMatch) {
        const val = stateMatch[1];
        names['#state'] = 'state';
        values[':state'] = val;
        expr = expr.replace(/state\s*=\s*[A-Za-z0-9_]+/, '#state = :state');
      }

      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: expr,
          ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
          ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
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

export async function updateRide(
  rideId: string,
  values: UpdateRideValues,
  condition?: string,
  client?: DynamoClient,
): Promise<Record<string, unknown>> {
  const targetClient =
    client ||
    new DynamoClient(
      process.env.RIDES_TABLE || process.env.DYNAMO_TABLE_NAME || 'ride-dispatch-platform-local',
      process.env.AWS_ENDPOINT_URL ||
        (process.env.LOCALSTACK_HOSTNAME ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566` : undefined) ||
        process.env.DYNAMO_ENDPOINT,
    );
  return targetClient.updateRide(rideId, values, condition);
}
