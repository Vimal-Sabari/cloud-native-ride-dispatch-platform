import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoClient } from './client';

const tableName = process.env.DYNAMO_TABLE_NAME || 'ride-dispatch-platform-local';
const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const client = new DynamoClient(tableName, endpoint);

describe('DynamoClient Integration Tests', () => {
  it('put and get item round-trip', async () => {
    const pk = `TEST#TS_PUT_GET#${Date.now()}`;
    const sk = 'METADATA';
    const item = {
      PK: pk,
      SK: sk,
      name: 'TypeScript Integration Test Item',
      count: 42,
    };

    await client.putItem(item);
    const retrieved = await client.getItem(pk, sk);

    assert.ok(retrieved !== null, 'retrieved item should not be null');
    assert.equal(retrieved.PK, pk);
    assert.equal(retrieved.SK, sk);
    assert.equal(retrieved.name, 'TypeScript Integration Test Item');
    assert.equal(retrieved.count, 42);
  });

  it('get non-existent item returns null without error', async () => {
    const pk = `NON_EXISTENT#${Date.now()}`;
    const sk = 'DATA';

    const retrieved = await client.getItem(pk, sk);
    assert.equal(retrieved, null);
  });

  it('query GSI1 returns multiple matching items', async () => {
    const gsi1pk = `GEOHASH#TS_TEST_${Date.now()}`;

    for (let i = 1; i <= 3; i++) {
      const pk = `DRIVER#TS_TEST_${Date.now()}_${i}`;
      const sk = 'LOCATION';
      const gsi1sk = `DRIVER#AVAILABLE#drv_${i}`;

      await client.putItem({
        PK: pk,
        SK: sk,
        GSI1PK: gsi1pk,
        GSI1SK: gsi1sk,
        driverIndex: i,
      });
    }

    const items = await client.query({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :gsi1pk',
      expressionAttributeValues: {
        ':gsi1pk': gsi1pk,
      },
    });

    assert.equal(items.length, 3);
  });

  it('conditionalPutItem returns true on fresh key, and false on duplicate key', async () => {
    const pk = `TEST#TS_COND_${Date.now()}`;
    const sk = 'ASSIGNMENT';
    const item = {
      PK: pk,
      SK: sk,
      status: 'ASSIGNED',
    };

    // First put on fresh key: succeeds -> true
    const firstSuccess = await client.conditionalPutItem(item, 'attribute_not_exists(PK)');
    assert.equal(firstSuccess, true);

    // Second put on same key: condition fails -> false (not thrown error)
    const secondSuccess = await client.conditionalPutItem(item, 'attribute_not_exists(PK)');
    assert.equal(secondSuccess, false);
  });

  it('concurrency race: exactly one of two concurrent conditionalPutItem calls wins', async () => {
    const pk = `RACE#TS_DRIVER#${Date.now()}`;
    const sk = 'ASSIGNMENT';

    const p1 = client.conditionalPutItem(
      { PK: pk, SK: sk, winner: 'worker1' },
      'attribute_not_exists(PK)',
    );
    const p2 = client.conditionalPutItem(
      { PK: pk, SK: sk, winner: 'worker2' },
      'attribute_not_exists(PK)',
    );

    const [r1, r2] = await Promise.all([p1, p2]);

    const winnerCount = (r1 ? 1 : 0) + (r2 ? 1 : 0);
    const loserCount = (!r1 ? 1 : 0) + (!r2 ? 1 : 0);

    assert.equal(winnerCount, 1, 'exactly one call should resolve true');
    assert.equal(loserCount, 1, 'exactly one call should resolve false');
  });
});
