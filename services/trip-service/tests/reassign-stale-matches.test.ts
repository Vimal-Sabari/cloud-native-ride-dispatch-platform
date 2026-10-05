import { FakeDynamoAccessor } from './helpers/fake-dynamo';
import { reassignStaleMatches, SqsSender } from '../src/handlers/reassign-stale-matches';
import { RideState } from '@ride-dispatch/models';

describe('Trip Service - Reassign Stale Matches Handler', () => {
  let fakeDynamo: FakeDynamoAccessor;
  let sentSqsMessages: { queueUrl: string; body: string }[];
  let fakeSqsSender: SqsSender;
  const QUEUE_URL = 'http://localhost:4566/000000000000/ride-request-events';
  const TIMEOUT_SECONDS = 60;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
    sentSqsMessages = [];
    fakeSqsSender = {
      async sendMessage(queueUrl: string, body: string): Promise<void> {
        sentSqsMessages.push({ queueUrl, body });
      },
    };
  });

  it('reassigns a ride MATCHED 90 seconds ago: reverts state to REQUESTED, releases driver to available, and sends ride-requested SQS event', async () => {
    const now = Date.now();
    const staleTime = new Date(now - 90 * 1000).toISOString();
    const rideId = 'stale-ride-90s';
    const driverId = 'driver-101';
    const riderId = 'rider-202';

    // Seed ride details item in MATCHED state with GSI4 attributes
    fakeDynamo.seed([
      {
        PK: `RIDE#${rideId}`,
        SK: 'DETAILS',
        rideId,
        riderId,
        state: RideState.MATCHED,
        driverId,
        pickup: { lat: 37.7749, lng: -122.4194 },
        dropoff: { lat: 37.7833, lng: -122.4167 },
        createdAt: staleTime,
        updatedAt: staleTime,
        GSI4PK: 'STATE#MATCHED',
        GSI4SK: staleTime,
      },
      // Seed driver item in busy state
      {
        PK: `DRIVER#${driverId}`,
        SK: 'LOCATION',
        driverId,
        status: 'busy',
        GSI1PK: 'GEOHASH#9q8yy',
        GSI1SK: `DRIVER#busy#${driverId}`,
        updatedAt: staleTime,
      },
      // Seed driver active ride pointer
      {
        PK: `DRIVER#${driverId}`,
        SK: 'ACTIVE_RIDE_POINTER',
        GSI3PK: `DRIVER#${driverId}`,
        GSI3SK: 'ACTIVE_RIDE',
        rideId,
      },
    ]);

    const result = await reassignStaleMatches(
      TIMEOUT_SECONDS,
      fakeDynamo,
      fakeSqsSender,
      QUEUE_URL,
    );

    expect(result.reassignedCount).toBe(1);
    expect(result.rideIds).toEqual([rideId]);

    // 1. Assert ride state became REQUESTED, driverId is cleared, and GSI4 attributes are removed
    const updatedRide = await fakeDynamo.getItem(`RIDE#${rideId}`, 'DETAILS');
    expect(updatedRide).toBeDefined();
    expect(updatedRide?.state).toBe(RideState.REQUESTED);
    expect(updatedRide?.driverId).toBeUndefined();
    expect(updatedRide?.GSI4PK).toBeUndefined();
    expect(updatedRide?.GSI4SK).toBeUndefined();

    // 2. Assert driver status became available and GSI1SK updated
    const updatedDriver = await fakeDynamo.getItem(`DRIVER#${driverId}`, 'LOCATION');
    expect(updatedDriver).toBeDefined();
    expect(updatedDriver?.status).toBe('available');
    expect(updatedDriver?.GSI1SK).toBe(`DRIVER#available#${driverId}`);

    // Assert driver active ride pointer was removed
    const activePointer = await fakeDynamo.getItem(`DRIVER#${driverId}`, 'ACTIVE_RIDE_POINTER');
    expect(activePointer).toBeNull();

    // 3. Assert exactly one SQS message was sent with exact Module 16 event-forwarder shape
    expect(sentSqsMessages).toHaveLength(1);
    expect(sentSqsMessages[0].queueUrl).toBe(QUEUE_URL);
    const parsedBody = JSON.parse(sentSqsMessages[0].body);
    expect(parsedBody).toEqual({
      eventType: 'ride-requested',
      payload: {
        rideId,
        riderId,
        pickup: { lat: 37.7749, lng: -122.4194 },
      },
    });
  });

  it('does NOT touch a ride MATCHED 10 seconds ago (within the 60s timeout)', async () => {
    const now = Date.now();
    const freshTime = new Date(now - 10 * 1000).toISOString();
    const rideId = 'fresh-ride-10s';
    const driverId = 'driver-202';
    const riderId = 'rider-303';

    fakeDynamo.seed([
      {
        PK: `RIDE#${rideId}`,
        SK: 'DETAILS',
        rideId,
        riderId,
        state: RideState.MATCHED,
        driverId,
        pickup: { lat: 37.7749, lng: -122.4194 },
        updatedAt: freshTime,
        GSI4PK: 'STATE#MATCHED',
        GSI4SK: freshTime,
      },
      {
        PK: `DRIVER#${driverId}`,
        SK: 'LOCATION',
        driverId,
        status: 'busy',
        updatedAt: freshTime,
      },
    ]);

    const result = await reassignStaleMatches(
      TIMEOUT_SECONDS,
      fakeDynamo,
      fakeSqsSender,
      QUEUE_URL,
    );

    expect(result.reassignedCount).toBe(0);
    expect(result.rideIds).toEqual([]);

    // Assert ride remained in MATCHED state
    const ride = await fakeDynamo.getItem(`RIDE#${rideId}`, 'DETAILS');
    expect(ride?.state).toBe(RideState.MATCHED);
    expect(ride?.driverId).toBe(driverId);

    // Assert driver remained busy
    const driver = await fakeDynamo.getItem(`DRIVER#${driverId}`, 'LOCATION');
    expect(driver?.status).toBe('busy');

    // Assert no SQS messages sent
    expect(sentSqsMessages).toHaveLength(0);
  });

  it('race condition: skips ride without error if conditionalPutItem returns false (e.g. driver accepted to DRIVER_EN_ROUTE in interim)', async () => {
    const now = Date.now();
    const staleTime = new Date(now - 90 * 1000).toISOString();
    const rideId = 'racing-ride-90s';
    const driverId = 'driver-303';
    const riderId = 'rider-404';

    fakeDynamo.seed([
      {
        PK: `RIDE#${rideId}`,
        SK: 'DETAILS',
        rideId,
        riderId,
        state: RideState.MATCHED,
        driverId,
        pickup: { lat: 37.7749, lng: -122.4194 },
        updatedAt: staleTime,
        GSI4PK: 'STATE#MATCHED',
        GSI4SK: staleTime,
      },
      {
        PK: `DRIVER#${driverId}`,
        SK: 'LOCATION',
        driverId,
        status: 'busy',
        updatedAt: staleTime,
      },
    ]);

    // Configure conditionalPutItem to return false simulating an optimistic locking race failure
    jest.spyOn(fakeDynamo, 'conditionalPutItem').mockResolvedValueOnce(false);

    const result = await reassignStaleMatches(
      TIMEOUT_SECONDS,
      fakeDynamo,
      fakeSqsSender,
      QUEUE_URL,
    );

    // Assert no error thrown, ride skipped
    expect(result.reassignedCount).toBe(0);
    expect(result.rideIds).toEqual([]);

    // Assert driver was NOT released (remains busy)
    const driver = await fakeDynamo.getItem(`DRIVER#${driverId}`, 'LOCATION');
    expect(driver?.status).toBe('busy');

    // Assert no SQS message was sent
    expect(sentSqsMessages).toHaveLength(0);
  });
});
