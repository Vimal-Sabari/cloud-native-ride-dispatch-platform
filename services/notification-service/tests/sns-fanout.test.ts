import { handleFanoutEvent, FanoutMessage } from '../src/handlers/sns-fanout';
import { ConnectionManager } from '../src/connection-manager';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

class FakeConnectionManager implements ConnectionManager {
  public posted: Array<{ connectionId: string; payload: Record<string, unknown> }> = [];
  public staleConnections = new Set<string>();
  public shouldThrow: Error | null = null;

  async postToConnection(
    connectionId: string,
    payload: Record<string, unknown>,
  ): Promise<{ stale: boolean }> {
    if (this.shouldThrow) {
      throw this.shouldThrow;
    }
    this.posted.push({ connectionId, payload });
    if (this.staleConnections.has(connectionId)) {
      return { stale: true };
    }
    return { stale: false };
  }
}

describe('Notification Service SNS Fan-out', () => {
  let fakeDynamo: FakeDynamoAccessor;
  let fakeConnectionManager: FakeConnectionManager;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
    fakeConnectionManager = new FakeConnectionManager();
  });

  const seedConnection = async (subjectId: string, connectionId: string) => {
    // 1. Forward lookup item
    await fakeDynamo.putItem({
      PK: `CONNECTION#${connectionId}`,
      SK: 'DETAILS',
      subjectId,
      connectedAt: new Date().toISOString(),
    });

    // 2. Reverse lookup item
    await fakeDynamo.putItem({
      PK: `USER#${subjectId}`,
      SK: `CONNECTION#${connectionId}`,
      connectedAt: new Date().toISOString(),
    });
  };

  it('delivers notification to a single connection on ride-matched event', async () => {
    const riderId = 'rider-123';
    const connectionId = 'conn-rider-1';
    await seedConnection(riderId, connectionId);

    const message: FanoutMessage = {
      eventType: 'ride-matched',
      rideId: 'ride-001',
      riderId,
      driverId: 'driver-456',
    };

    await handleFanoutEvent(message, {
      ...fakeDynamo,
      getItem: (pk, sk) => fakeDynamo.getItem(pk, sk),
      putItem: (item) => fakeDynamo.putItem(item),
      deleteItem: (pk, sk) => fakeDynamo.deleteItem(pk, sk),
      query: (opt) => fakeDynamo.query(opt),
      connectionManager: fakeConnectionManager,
    });

    expect(fakeConnectionManager.posted).toHaveLength(1);
    expect(fakeConnectionManager.posted[0].connectionId).toBe(connectionId);
    expect(fakeConnectionManager.posted[0].payload).toEqual(message);
    expect(fakeDynamo.deleteCalls).toHaveLength(0);
  });

  it('delivers notification to multiple connections for a single subject', async () => {
    const riderId = 'rider-multi';
    const conn1 = 'conn-rider-phone';
    const conn2 = 'conn-rider-laptop';
    await seedConnection(riderId, conn1);
    await seedConnection(riderId, conn2);

    const message: FanoutMessage = {
      eventType: 'ride-matched',
      rideId: 'ride-002',
      riderId,
    };

    await handleFanoutEvent(message, {
      ...fakeDynamo,
      getItem: (pk, sk) => fakeDynamo.getItem(pk, sk),
      putItem: (item) => fakeDynamo.putItem(item),
      deleteItem: (pk, sk) => fakeDynamo.deleteItem(pk, sk),
      query: (opt) => fakeDynamo.query(opt),
      connectionManager: fakeConnectionManager,
    });

    expect(fakeConnectionManager.posted).toHaveLength(2);
    const postedConnectionIds = fakeConnectionManager.posted.map((p) => p.connectionId).sort();
    expect(postedConnectionIds).toEqual([conn1, conn2].sort());
    expect(fakeDynamo.deleteCalls).toHaveLength(0);
  });

  it('delivers notification to both rider and driver connections concurrently', async () => {
    const riderId = 'rider-dual';
    const driverId = 'driver-dual';
    const riderConn = 'conn-rider-dual';
    const driverConn = 'conn-driver-dual';

    await seedConnection(riderId, riderConn);
    await seedConnection(driverId, driverConn);

    const message: FanoutMessage = {
      eventType: 'ride-matched',
      rideId: 'ride-dual-01',
      riderId,
      driverId,
    };

    await handleFanoutEvent(message, {
      ...fakeDynamo,
      getItem: (pk, sk) => fakeDynamo.getItem(pk, sk),
      putItem: (item) => fakeDynamo.putItem(item),
      deleteItem: (pk, sk) => fakeDynamo.deleteItem(pk, sk),
      query: (opt) => fakeDynamo.query(opt),
      connectionManager: fakeConnectionManager,
    });

    expect(fakeConnectionManager.posted).toHaveLength(2);
    const postedIds = fakeConnectionManager.posted.map((p) => p.connectionId).sort();
    expect(postedIds).toEqual([driverConn, riderConn].sort());
    expect(fakeDynamo.deleteCalls).toHaveLength(0);
  });

  it('cleans up both DynamoDB records when a connection is stale ({ stale: true })', async () => {
    const riderId = 'rider-stale';
    const staleConn = 'conn-stale-1';
    await seedConnection(riderId, staleConn);

    fakeConnectionManager.staleConnections.add(staleConn);

    const message: FanoutMessage = {
      eventType: 'ride-cancelled',
      rideId: 'ride-003',
      riderId,
    };

    await handleFanoutEvent(message, {
      ...fakeDynamo,
      getItem: (pk, sk) => fakeDynamo.getItem(pk, sk),
      putItem: (item) => fakeDynamo.putItem(item),
      deleteItem: (pk, sk) => fakeDynamo.deleteItem(pk, sk),
      query: (opt) => fakeDynamo.query(opt),
      connectionManager: fakeConnectionManager,
    });

    expect(fakeConnectionManager.posted).toHaveLength(1);
    expect(fakeConnectionManager.posted[0].connectionId).toBe(staleConn);

    // Exactly two deleteItem calls: DETAILS record and USER connection record
    expect(fakeDynamo.deleteCalls).toHaveLength(2);
    expect(fakeDynamo.deleteCalls).toContainEqual({
      pk: `CONNECTION#${staleConn}`,
      sk: 'DETAILS',
    });
    expect(fakeDynamo.deleteCalls).toContainEqual({
      pk: `USER#${riderId}`,
      sk: `CONNECTION#${staleConn}`,
    });

    // Ensure records are deleted from storage
    expect(fakeDynamo.get(`CONNECTION#${staleConn}`, 'DETAILS')).toBeUndefined();
    expect(fakeDynamo.get(`USER#${riderId}`, `CONNECTION#${staleConn}`)).toBeUndefined();
  });

  it('silently ignores unrecognized event types without making DynamoDB or connection-manager calls', async () => {
    const riderId = 'rider-unknown';
    await seedConnection(riderId, 'conn-unknown');

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const unknownMessage = {
      eventType: 'ride-billing-updated',
      rideId: 'ride-unknown-type',
      riderId,
    } as unknown as FanoutMessage;

    await handleFanoutEvent(unknownMessage, {
      ...fakeDynamo,
      getItem: (pk, sk) => fakeDynamo.getItem(pk, sk),
      putItem: (item) => fakeDynamo.putItem(item),
      deleteItem: (pk, sk) => fakeDynamo.deleteItem(pk, sk),
      query: (opt) => fakeDynamo.query(opt),
      connectionManager: fakeConnectionManager,
    });

    expect(fakeConnectionManager.posted).toHaveLength(0);
    expect(fakeDynamo.deleteCalls).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unrecognized or unsupported eventType 'ride-billing-updated'"),
    );

    logSpy.mockRestore();
  });

  it('gracefully returns when target subjects have no active connections', async () => {
    const message: FanoutMessage = {
      eventType: 'ride-matched',
      rideId: 'ride-no-conn',
      riderId: 'rider-without-connection',
      driverId: 'driver-without-connection',
    };

    await handleFanoutEvent(message, {
      ...fakeDynamo,
      getItem: (pk, sk) => fakeDynamo.getItem(pk, sk),
      putItem: (item) => fakeDynamo.putItem(item),
      deleteItem: (pk, sk) => fakeDynamo.deleteItem(pk, sk),
      query: (opt) => fakeDynamo.query(opt),
      connectionManager: fakeConnectionManager,
    });

    expect(fakeConnectionManager.posted).toHaveLength(0);
    expect(fakeDynamo.deleteCalls).toHaveLength(0);
  });

  it('propagates unexpected error from ConnectionManager', async () => {
    const riderId = 'rider-err';
    const connId = 'conn-err-1';
    await seedConnection(riderId, connId);

    fakeConnectionManager.shouldThrow = new Error('500 Internal Server Error');

    const message: FanoutMessage = {
      eventType: 'ride-matched',
      rideId: 'ride-err',
      riderId,
    };

    await expect(
      handleFanoutEvent(message, {
        ...fakeDynamo,
        getItem: (pk, sk) => fakeDynamo.getItem(pk, sk),
        putItem: (item) => fakeDynamo.putItem(item),
        deleteItem: (pk, sk) => fakeDynamo.deleteItem(pk, sk),
        query: (opt) => fakeDynamo.query(opt),
        connectionManager: fakeConnectionManager,
      }),
    ).rejects.toThrow('500 Internal Server Error');
  });
});
