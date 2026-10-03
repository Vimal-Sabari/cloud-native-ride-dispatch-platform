import { DynamoAccessor } from '@ride-dispatch/dynamo-client';

export class FakeDynamoAccessor implements DynamoAccessor {
  private readonly storage = new Map<string, Record<string, unknown>>();
  public deleteCalls: Array<{ pk: string; sk: string }> = [];
  public putCalls: Array<Record<string, unknown>> = [];

  private makeKey(pk: unknown, sk: unknown): string {
    return `${String(pk)}#${String(sk)}`;
  }

  async getItem(pk: string, sk: string): Promise<Record<string, unknown> | null> {
    const key = this.makeKey(pk, sk);
    const item = this.storage.get(key);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async putItem(item: Record<string, unknown>): Promise<void> {
    this.putCalls.push(JSON.parse(JSON.stringify(item)));
    const key = this.makeKey(item.PK, item.SK);
    this.storage.set(key, JSON.parse(JSON.stringify(item)));
  }

  async deleteItem(pk: string, sk: string): Promise<void> {
    this.deleteCalls.push({ pk, sk });
    const key = this.makeKey(pk, sk);
    this.storage.delete(key);
  }

  async query(input: {
    indexName?: string;
    keyConditionExpression: string;
    expressionAttributeValues: Record<string, unknown>;
  }): Promise<Record<string, unknown>[]> {
    const targetPk = input.expressionAttributeValues[':pk'] as string | undefined;
    const prefix = input.expressionAttributeValues[':skPrefix'] as string | undefined;

    const results: Record<string, unknown>[] = [];
    for (const item of this.storage.values()) {
      if (targetPk && item.PK !== targetPk) {
        continue;
      }
      if (prefix && typeof item.SK === 'string' && !item.SK.startsWith(prefix)) {
        continue;
      }
      results.push(JSON.parse(JSON.stringify(item)));
    }
    return results;
  }

  // Test helpers
  seed(items: Record<string, unknown>[]): void {
    for (const item of items) {
      const key = this.makeKey(item.PK, item.SK);
      this.storage.set(key, JSON.parse(JSON.stringify(item)));
    }
  }

  get(pk: string, sk: string): Record<string, unknown> | undefined {
    return this.storage.get(this.makeKey(pk, sk));
  }

  clear(): void {
    this.storage.clear();
    this.deleteCalls = [];
    this.putCalls = [];
  }
}
