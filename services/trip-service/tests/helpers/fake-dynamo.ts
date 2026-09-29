/**
 * In-memory test fake for DynamoAccessor.
 *
 * ARCHITECTURAL NOTE:
 * This fake is intentionally scoped for unit testing Trip Service handlers without
 * any live AWS or LocalStack dependency. It provides exact in-memory semantics for:
 * 1. Primary key item access (PK + SK)
 * 2. GSI queries via partition key equality
 * 3. Conditional writes supporting `attribute_not_exists(PK)` and `state = <VALUE>`
 *
 * It is NOT a generalized DynamoDB emulator or full AST parser.
 */

import { DynamoAccessor, QueryInput } from '../../src/dynamo-accessor';

export class FakeDynamoAccessor implements DynamoAccessor {
  private readonly storage = new Map<string, Record<string, unknown>>();

  private makeKey(pk: unknown, sk: unknown): string {
    return `${String(pk)}#${String(sk)}`;
  }

  async getItem(pk: string, sk: string): Promise<Record<string, unknown> | null> {
    const key = this.makeKey(pk, sk);
    const item = this.storage.get(key);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async putItem(item: Record<string, unknown>): Promise<void> {
    const key = this.makeKey(item.PK, item.SK);
    this.storage.set(key, JSON.parse(JSON.stringify(item)));
  }

  async deleteItem(pk: string, sk: string): Promise<void> {
    const key = this.makeKey(pk, sk);
    this.storage.delete(key);
  }

  async query(input: QueryInput): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];

    // Extract target partition key value from expressionAttributeValues (e.g. { ":gsi2pk": "RIDER#..." })
    const targetValues = Object.values(input.expressionAttributeValues);

    for (const item of this.storage.values()) {
      if (input.indexName === 'GSI2') {
        if (targetValues.includes(item.GSI2PK)) {
          results.push(JSON.parse(JSON.stringify(item)));
        }
      } else if (input.indexName === 'GSI3') {
        if (targetValues.includes(item.GSI3PK)) {
          results.push(JSON.parse(JSON.stringify(item)));
        }
      } else {
        // Main table scan fallback
        if (targetValues.includes(item.PK)) {
          results.push(JSON.parse(JSON.stringify(item)));
        }
      }
    }

    return results;
  }

  async conditionalPutItem(
    item: Record<string, unknown>,
    conditionExpression: string,
  ): Promise<boolean> {
    const key = this.makeKey(item.PK, item.SK);
    const existing = this.storage.get(key);

    const normalizedExpr = conditionExpression.trim();

    // Pattern 1: attribute_not_exists(PK) or attribute_not_exists(pk)
    if (/^attribute_not_exists\s*\(\s*pk\s*\)$/i.test(normalizedExpr)) {
      if (existing !== undefined) {
        return false; // Item already exists; condition check fails
      }
      this.storage.set(key, JSON.parse(JSON.stringify(item)));
      return true;
    }

    // Pattern 2: state = <VALUE> or #state = :<VALUE>
    const stateMatch = normalizedExpr.match(/^(?:#state|state)\s*=\s*(.+)$/i);
    if (stateMatch) {
      let expectedState = stateMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (expectedState.startsWith(':')) {
        expectedState = expectedState.slice(1).toUpperCase();
      }
      if (!existing || existing.state !== expectedState) {
        return false; // Stored state does not match expected state
      }
      this.storage.set(key, JSON.parse(JSON.stringify(item)));
      return true;
    }

    throw new Error(
      `FakeDynamoAccessor: unsupported conditionExpression: "${conditionExpression}". ` +
        `This test fake only supports attribute_not_exists(PK) and state = <value>.`,
    );
  }

  async updateRide(
    rideId: string,
    values: { state?: string; driverId?: string },
    condition?: string,
    extraExpressionValues?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const cleanRideId = rideId.startsWith('RIDE#') ? rideId.slice(5) : rideId;
    const key = this.makeKey(`RIDE#${cleanRideId}`, 'DETAILS');
    const existing = this.storage.get(key);

    if (!existing) {
      const err = new Error('ResourceNotFoundException');
      err.name = 'ResourceNotFoundException';
      throw err;
    }

    // Check if conditionalPutItem was mocked or if condition checks fail
    const dummyItem = { PK: `RIDE#${cleanRideId}`, SK: 'DETAILS', ...existing };
    const canPut = await this.conditionalPutItem(dummyItem, condition || 'state = REQUESTED');
    if (!canPut) {
      const err = new Error('ConditionalCheckFailedException');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }

    if (condition) {
      const normalized = condition.trim();
      if (normalized.includes(':requested') && existing.state !== 'REQUESTED') {
        const err = new Error('ConditionalCheckFailedException');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      if (normalized.includes(':matched') && existing.state !== 'MATCHED') {
        const err = new Error('ConditionalCheckFailedException');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      if (normalized.includes(':driver_en_route') && existing.state !== 'DRIVER_EN_ROUTE') {
        const err = new Error('ConditionalCheckFailedException');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      if (normalized.includes(':expectedState')) {
        const expected = extraExpressionValues?.[':expectedState'];
        if (expected && existing.state !== expected) {
          const err = new Error('ConditionalCheckFailedException');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
      }
    }

    const updated = {
      ...existing,
      ...(values.state !== undefined ? { state: values.state } : {}),
      ...(values.driverId !== undefined ? { driverId: values.driverId } : {}),
      updatedAt: new Date().toISOString(),
    };

    this.storage.set(key, JSON.parse(JSON.stringify(updated)));
    return updated;
  }

  // Test helper utilities
  clear(): void {
    this.storage.clear();
  }

  seed(items: Record<string, unknown>[]): void {
    for (const item of items) {
      const key = this.makeKey(item.PK, item.SK);
      this.storage.set(key, JSON.parse(JSON.stringify(item)));
    }
  }

  dump(): Record<string, unknown>[] {
    return Array.from(this.storage.values());
  }
}
