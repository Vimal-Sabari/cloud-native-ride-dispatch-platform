/**
 * Narrow data-access interface for Trip Service handlers.
 *
 * Handlers depend strictly on this abstraction rather than the concrete AWS SDK
 * or DynamoClient class, enabling framework-free unit testing via in-memory fakes.
 */

export interface QueryInput {
  indexName?: string;
  keyConditionExpression: string;
  expressionAttributeValues: Record<string, unknown>;
}

export interface SnsPublisher {
  publish(topicArn: string, message: Record<string, unknown>): Promise<void>;
}

export interface DynamoAccessor {
  getItem(pk: string, sk: string): Promise<Record<string, unknown> | null>;
  putItem(item: Record<string, unknown>): Promise<void>;
  deleteItem(pk: string, sk: string): Promise<void>;
  query(input: QueryInput): Promise<Record<string, unknown>[]>;
  conditionalPutItem(
    item: Record<string, unknown>,
    conditionExpression: string,
    expressionAttributeNames?: Record<string, string>,
    expressionAttributeValues?: Record<string, unknown>,
  ): Promise<boolean>;
  updateRide(
    rideId: string,
    values: { state?: string; driverId?: string },
    condition?: string,
    extraExpressionValues?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}
