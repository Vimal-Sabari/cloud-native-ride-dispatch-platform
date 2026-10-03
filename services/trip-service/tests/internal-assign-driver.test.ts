import { RideState } from '@ride-dispatch/models';
import { assignDriver } from '../src/handlers/internal-assign-driver';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('internal assignDriver handler', () => {
  let fakeDynamo: FakeDynamoAccessor;
  const originalEnv = process.env;
  const TEST_API_KEY = 'test-internal-secret-key-123';

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
    process.env = { ...originalEnv, INTERNAL_API_KEY: TEST_API_KEY };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const validHeaders = { 'x-internal-api-key': TEST_API_KEY };

  const seedRide = async (rideId: string, state: RideState) => {
    const item = {
      PK: `RIDE#${rideId}`,
      SK: 'DETAILS',
      rideId,
      riderId: 'rider-1',
      state,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    };
    await fakeDynamo.putItem(item);
    return item;
  };

  describe('API key authentication', () => {
    it('returns 401 when x-internal-api-key header is missing', async () => {
      const res = await assignDriver('ride-1', 'driver-1', fakeDynamo, {});
      expect(res.statusCode).toBe(401);
      expect((res.body as { error: string }).error).toContain('Unauthorized');
    });

    it('returns 401 when x-internal-api-key header does not match', async () => {
      const res = await assignDriver('ride-1', 'driver-1', fakeDynamo, {
        'x-internal-api-key': 'wrong-key',
      });
      expect(res.statusCode).toBe(401);
    });

    it('accepts header in case-insensitive format (X-Internal-Api-Key)', async () => {
      await seedRide('ride-1', RideState.REQUESTED);
      const res = await assignDriver('ride-1', 'driver-1', fakeDynamo, {
        'X-Internal-Api-Key': TEST_API_KEY,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('happy path driver assignment', () => {
    it('transitions REQUESTED ride to MATCHED and creates GSI3 pointer', async () => {
      const rideId = 'ride-match-1';
      const driverId = 'driver-42';
      await seedRide(rideId, RideState.REQUESTED);

      const res = await assignDriver(rideId, driverId, fakeDynamo, validHeaders);
      expect(res.statusCode).toBe(200);

      const body = res.body as Record<string, unknown>;
      expect(body.state).toBe(RideState.MATCHED);
      expect(body.driverId).toBe(driverId);
      expect(body.updatedAt).not.toBe('2026-09-20T10:00:00.000Z');

      // Verify ride update in storage
      const storedRide = await fakeDynamo.getItem(`RIDE#${rideId}`, 'DETAILS');
      expect(storedRide?.state).toBe(RideState.MATCHED);
      expect(storedRide?.driverId).toBe(driverId);

      // Verify GSI3 driver active ride pointer
      const storedPointer = await fakeDynamo.getItem(`DRIVER#${driverId}`, 'ACTIVE_RIDE_POINTER');
      expect(storedPointer).toBeDefined();
      expect(storedPointer?.GSI3PK).toBe(`DRIVER#${driverId}`);
      expect(storedPointer?.GSI3SK).toBe('ACTIVE_RIDE');
      expect(storedPointer?.rideId).toBe(rideId);
    });

    it('publishes ride-matched event to SNS on success', async () => {
      const rideId = 'ride-match-sns';
      const driverId = 'driver-42';
      await seedRide(rideId, RideState.REQUESTED);

      const fakeSns = {
        published: [] as Array<{ topicArn: string; message: Record<string, unknown> }>,
        publish: jest.fn(async (topicArn: string, message: Record<string, unknown>) => {
          fakeSns.published.push({ topicArn, message });
        }),
      };

      const topicArn = 'arn:aws:sns:us-east-1:123456789012:match-events';
      const res = await assignDriver(rideId, driverId, fakeDynamo, validHeaders, fakeSns, topicArn);
      expect(res.statusCode).toBe(200);

      expect(fakeSns.publish).toHaveBeenCalledTimes(1);
      expect(fakeSns.published[0].topicArn).toBe(topicArn);
      expect(fakeSns.published[0].message).toMatchObject({
        eventType: 'ride-matched',
        rideId,
        riderId: 'rider-1',
        driverId,
      });
      expect(typeof fakeSns.published[0].message.timestamp).toBe('string');
    });

    it('still returns 200 OK when SNS publish throws (best-effort non-blocking failure)', async () => {
      const rideId = 'ride-match-sns-fail';
      const driverId = 'driver-42';
      await seedRide(rideId, RideState.REQUESTED);

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const failingSns = {
        publish: jest.fn().mockRejectedValue(new Error('SNS service unavailable')),
      };

      const topicArn = 'arn:aws:sns:us-east-1:123456789012:match-events';
      const res = await assignDriver(rideId, driverId, fakeDynamo, validHeaders, failingSns, topicArn);

      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.state).toBe(RideState.MATCHED);

      // Verify ride was STILL transitioned to MATCHED in storage
      const storedRide = await fakeDynamo.getItem(`RIDE#${rideId}`, 'DETAILS');
      expect(storedRide?.state).toBe(RideState.MATCHED);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to publish ride-matched event to SNS'),
        expect.anything(),
      );

      warnSpy.mockRestore();
    });
  });

  describe('error and edge cases', () => {
    it('returns 404 if ride does not exist', async () => {
      const res = await assignDriver('non-existent-ride', 'driver-1', fakeDynamo, validHeaders);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Ride non-existent-ride not found' });
    });

    it('returns 400 if rideId or driverId is invalid', async () => {
      const res1 = await assignDriver('', 'driver-1', fakeDynamo, validHeaders);
      expect(res1.statusCode).toBe(400);

      const res2 = await assignDriver('ride-1', '', fakeDynamo, validHeaders);
      expect(res2.statusCode).toBe(400);
    });

    it.each([
      RideState.MATCHED,
      RideState.DRIVER_EN_ROUTE,
      RideState.IN_PROGRESS,
      RideState.COMPLETED,
      RideState.CANCELLED,
    ])(
      'rejects assignment if ride is already in %s state with 409 Conflict',
      async (nonRequestedState) => {
        const rideId = `ride-invalid-${nonRequestedState}`;
        await seedRide(rideId, nonRequestedState);

        const res = await assignDriver(rideId, 'driver-1', fakeDynamo, validHeaders);
        expect(res.statusCode).toBe(409);
        expect((res.body as { error: string }).error).toContain(
          `Cannot transition ride ${rideId} from state '${nonRequestedState}' to 'MATCHED'`,
        );
      },
    );

    it('returns 409 when concurrent update causes conditional put to fail', async () => {
      const rideId = 'ride-race-assign';
      await seedRide(rideId, RideState.REQUESTED);

      jest.spyOn(fakeDynamo, 'conditionalPutItem').mockResolvedValueOnce(false);

      const res = await assignDriver(rideId, 'driver-1', fakeDynamo, validHeaders);
      expect(res.statusCode).toBe(409);
      expect((res.body as { error: string }).error).toContain(
        'Concurrent state modification detected',
      );
    });
  });
});
