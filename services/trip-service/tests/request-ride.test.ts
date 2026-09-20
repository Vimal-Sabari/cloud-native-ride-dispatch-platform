import { RideState } from '@ride-dispatch/models';
import { requestRide } from '../src/handlers/request-ride';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('requestRide handler', () => {
  let fakeDynamo: FakeDynamoAccessor;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
  });

  const validBody = {
    pickup: { lat: 37.7749, lng: -122.4194 },
    dropoff: { lat: 37.7833, lng: -122.4167 },
  };

  it('creates a new ride with REQUESTED state on valid input (201 Created)', async () => {
    const res = await requestRide('rider-123', validBody, fakeDynamo);

    expect(res.statusCode).toBe(201);
    const ride = res.body as Record<string, unknown>;
    expect(ride.rideId).toBeDefined();
    expect(ride.riderId).toBe('rider-123');
    expect(ride.state).toBe(RideState.REQUESTED);
    expect(ride.PK).toBe(`RIDE#${ride.rideId}`);
    expect(ride.SK).toBe('DETAILS');
    expect(ride.GSI2PK).toBe('RIDER#rider-123');
    expect(ride.GSI2SK).toContain(`RIDE#`);
    expect(ride.createdAt).toBeDefined();
    expect(ride.updatedAt).toBe(ride.createdAt);

    // Verify item in DynamoDB storage
    const stored = await fakeDynamo.getItem(`RIDE#${ride.rideId}`, 'DETAILS');
    expect(stored).toEqual(ride);
  });

  it('returns 400 for empty or invalid riderId', async () => {
    const res = await requestRide('', validBody, fakeDynamo);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid or missing riderId' });
  });

  it('returns 400 for invalid pickup coordinates', async () => {
    const invalidBody = {
      pickup: { lat: 95, lng: -122.4194 }, // lat > 90
      dropoff: { lat: 37.7833, lng: -122.4167 },
    };
    const res = await requestRide('rider-123', invalidBody, fakeDynamo);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('Invalid pickup coordinates');
  });

  it('returns 400 for invalid dropoff coordinates', async () => {
    const invalidBody = {
      pickup: { lat: 37.7749, lng: -122.4194 },
      dropoff: { lat: 37.7833, lng: -200 }, // lng < -180
    };
    const res = await requestRide('rider-123', invalidBody, fakeDynamo);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('Invalid dropoff coordinates');
  });

  describe('idempotency handling', () => {
    it('creates pointer and stores idempotencyKey on initial request', async () => {
      const bodyWithKey = {
        ...validBody,
        idempotencyKey: 'client-req-abc-1',
      };

      const res = await requestRide('rider-123', bodyWithKey, fakeDynamo);
      expect(res.statusCode).toBe(201);
      const ride = res.body as Record<string, unknown>;

      // Check idempotency pointer in storage
      const pointer = await fakeDynamo.getItem(
        'IDEMPOTENCY#rider-123#client-req-abc-1',
        'RIDE_POINTER',
      );
      expect(pointer).toBeDefined();
      expect(pointer?.rideId).toBe(ride.rideId);
    });

    it('replays existing ride (200 OK) on duplicate request with same idempotencyKey', async () => {
      const bodyWithKey = {
        ...validBody,
        idempotencyKey: 'client-req-abc-2',
      };

      // 1. Initial request
      const res1 = await requestRide('rider-123', bodyWithKey, fakeDynamo);
      expect(res1.statusCode).toBe(201);
      const ride1 = res1.body as Record<string, unknown>;

      // 2. Duplicate request with identical riderId and idempotencyKey
      const res2 = await requestRide('rider-123', bodyWithKey, fakeDynamo);
      expect(res2.statusCode).toBe(200);
      const ride2 = res2.body as Record<string, unknown>;

      // Must return identical ride without generating a new ID
      expect(ride2.rideId).toBe(ride1.rideId);
      expect(ride2.createdAt).toBe(ride1.createdAt);
    });

    it('resolves race condition when concurrent request wins the pointer write race', async () => {
      const bodyWithKey = {
        ...validBody,
        idempotencyKey: 'client-req-race-1',
      };

      const winnerRideId = 'winner-ride-999';
      const now = new Date().toISOString();

      // Intercept conditionalPutItem: simulate a concurrent worker writing the pointer
      // and ride right as our conditionalPutItem executes, causing it to return false
      jest.spyOn(fakeDynamo, 'conditionalPutItem').mockImplementationOnce(async () => {
        // Concurrent worker won the race
        await fakeDynamo.putItem({
          PK: `RIDE#${winnerRideId}`,
          SK: 'DETAILS',
          GSI2PK: 'RIDER#rider-123',
          GSI2SK: `RIDE#${now}#${winnerRideId}`,
          rideId: winnerRideId,
          riderId: 'rider-123',
          state: RideState.REQUESTED,
          pickup: validBody.pickup,
          dropoff: validBody.dropoff,
          createdAt: now,
          updatedAt: now,
          idempotencyKey: 'client-req-race-1',
        });

        await fakeDynamo.putItem({
          PK: 'IDEMPOTENCY#rider-123#client-req-race-1',
          SK: 'RIDE_POINTER',
          rideId: winnerRideId,
          createdAt: now,
        });

        return false;
      });

      const res = await requestRide('rider-123', bodyWithKey, fakeDynamo);

      expect(res.statusCode).toBe(200);
      const returnedRide = res.body as Record<string, unknown>;
      expect(returnedRide.rideId).toBe(winnerRideId);
    });
  });
});
