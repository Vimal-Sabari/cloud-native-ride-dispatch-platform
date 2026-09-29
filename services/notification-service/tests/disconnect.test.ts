import { handleDisconnect } from '../src/handlers/disconnect';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('Notification Service - handleDisconnect', () => {
  let fakeDynamo: FakeDynamoAccessor;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
  });

  it('cleans up both forward and reverse lookup items when a prior connection record exists', async () => {
    const connectionId = 'conn-active-123';
    const subjectId = 'driver-456';

    // Seed prior records
    fakeDynamo.seed([
      {
        PK: `CONNECTION#${connectionId}`,
        SK: 'DETAILS',
        subjectId,
        role: 'driver',
        connectedAt: '2026-09-29T12:00:00.000Z',
      },
      {
        PK: `USER#${subjectId}`,
        SK: `CONNECTION#${connectionId}`,
        connectedAt: '2026-09-29T12:00:00.000Z',
      },
    ]);

    const result = await handleDisconnect(connectionId, fakeDynamo);

    expect(result.statusCode).toBe(200);

    // Verify both items were deleted
    expect(fakeDynamo.deleteCalls).toHaveLength(2);
    expect(fakeDynamo.deleteCalls).toContainEqual({
      pk: `CONNECTION#${connectionId}`,
      sk: 'DETAILS',
    });
    expect(fakeDynamo.deleteCalls).toContainEqual({
      pk: `USER#${subjectId}`,
      sk: `CONNECTION#${connectionId}`,
    });

    // Verify storage is empty for those keys
    expect(fakeDynamo.get(`CONNECTION#${connectionId}`, 'DETAILS')).toBeUndefined();
    expect(fakeDynamo.get(`USER#${subjectId}`, `CONNECTION#${connectionId}`)).toBeUndefined();
  });

  it('gracefully handles missing prior connection record with 200 and no delete calls', async () => {
    const connectionId = 'conn-never-authenticated';

    const result = await handleDisconnect(connectionId, fakeDynamo);

    expect(result.statusCode).toBe(200);
    expect(fakeDynamo.deleteCalls).toHaveLength(0);
  });
});
