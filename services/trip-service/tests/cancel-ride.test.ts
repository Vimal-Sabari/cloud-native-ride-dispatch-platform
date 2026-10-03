import { RideState } from '@ride-dispatch/models';
import { cancelRide } from '../src/handlers/cancel-ride';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('cancelRide handler', () => {
  let fakeDynamo: FakeDynamoAccessor;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
  });

  const createTestRide = async (rideId: string, state: RideState, driverId?: string) => {
    const item: Record<string, unknown> = {
      PK: `RIDE#${rideId}`,
      SK: 'DETAILS',
      rideId,
      riderId: 'rider-1',
      state,
      pickup: { lat: 37.77, lng: -122.41 },
      dropoff: { lat: 37.78, lng: -122.42 },
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    };
    if (driverId) {
      item.driverId = driverId;
    }
    await fakeDynamo.putItem(item);
    return item;
  };

  describe('legal cancellations', () => {
    it.each([RideState.REQUESTED, RideState.MATCHED, RideState.DRIVER_EN_ROUTE])(
      'cancels ride in %s state (200 OK)',
      async (initialState) => {
        const rideId = `ride-cancel-${initialState}`;
        await createTestRide(rideId, initialState);

        const res = await cancelRide(rideId, fakeDynamo);
        expect(res.statusCode).toBe(200);

        const body = res.body as Record<string, unknown>;
        expect(body.state).toBe(RideState.CANCELLED);
        expect(body.updatedAt).not.toBe('2026-09-20T10:00:00.000Z');

        const stored = await fakeDynamo.getItem(`RIDE#${rideId}`, 'DETAILS');
        expect(stored?.state).toBe(RideState.CANCELLED);
      },
    );

    it('publishes ride-cancelled event to SNS without driverId when cancelling REQUESTED ride', async () => {
      const rideId = 'ride-cancel-sns-requested';
      await createTestRide(rideId, RideState.REQUESTED);

      const fakeSns = {
        published: [] as Array<{ topicArn: string; message: Record<string, unknown> }>,
        publish: jest.fn(async (topicArn: string, message: Record<string, unknown>) => {
          fakeSns.published.push({ topicArn, message });
        }),
      };

      const topicArn = 'arn:aws:sns:us-east-1:123456789012:match-events';
      const res = await cancelRide(rideId, fakeDynamo, fakeSns, topicArn);
      expect(res.statusCode).toBe(200);

      expect(fakeSns.publish).toHaveBeenCalledTimes(1);
      expect(fakeSns.published[0].topicArn).toBe(topicArn);
      expect(fakeSns.published[0].message).toMatchObject({
        eventType: 'ride-cancelled',
        rideId,
        riderId: 'rider-1',
      });
      expect(fakeSns.published[0].message.driverId).toBeUndefined();
    });

    it('publishes ride-cancelled event to SNS with driverId when cancelling MATCHED or DRIVER_EN_ROUTE ride', async () => {
      const rideId = 'ride-cancel-sns-matched';
      const driverId = 'driver-99';
      await createTestRide(rideId, RideState.MATCHED, driverId);

      const fakeSns = {
        published: [] as Array<{ topicArn: string; message: Record<string, unknown> }>,
        publish: jest.fn(async (topicArn: string, message: Record<string, unknown>) => {
          fakeSns.published.push({ topicArn, message });
        }),
      };

      const topicArn = 'arn:aws:sns:us-east-1:123456789012:match-events';
      const res = await cancelRide(rideId, fakeDynamo, fakeSns, topicArn);
      expect(res.statusCode).toBe(200);

      expect(fakeSns.publish).toHaveBeenCalledTimes(1);
      expect(fakeSns.published[0].message).toMatchObject({
        eventType: 'ride-cancelled',
        rideId,
        riderId: 'rider-1',
        driverId,
      });
    });

    it('still returns 200 OK when SNS publish throws (best-effort non-blocking failure)', async () => {
      const rideId = 'ride-cancel-sns-fail';
      await createTestRide(rideId, RideState.MATCHED, 'driver-12');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const failingSns = {
        publish: jest.fn().mockRejectedValue(new Error('SNS connection timed out')),
      };

      const topicArn = 'arn:aws:sns:us-east-1:123456789012:match-events';
      const res = await cancelRide(rideId, fakeDynamo, failingSns, topicArn);

      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.state).toBe(RideState.CANCELLED);

      const stored = await fakeDynamo.getItem(`RIDE#${rideId}`, 'DETAILS');
      expect(stored?.state).toBe(RideState.CANCELLED);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to publish ride-cancelled event to SNS'),
        expect.anything(),
      );

      warnSpy.mockRestore();
    });
  });

  describe('illegal cancellations', () => {
    it.each([RideState.IN_PROGRESS, RideState.COMPLETED, RideState.CANCELLED])(
      'rejects cancellation in %s state with 409 Conflict without writing',
      async (terminalOrActiveState) => {
        const rideId = `ride-illegal-${terminalOrActiveState}`;
        await createTestRide(rideId, terminalOrActiveState);

        const res = await cancelRide(rideId, fakeDynamo);
        expect(res.statusCode).toBe(409);
        expect((res.body as { error: string }).error).toContain(
          `Cannot transition ride ${rideId} from state '${terminalOrActiveState}' to 'CANCELLED'`,
        );

        // Verify item was NOT mutated
        const stored = await fakeDynamo.getItem(`RIDE#${rideId}`, 'DETAILS');
        expect(stored?.state).toBe(terminalOrActiveState);
      },
    );
  });

  it('returns 404 if ride does not exist', async () => {
    const res = await cancelRide('missing-ride', fakeDynamo);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Ride missing-ride not found' });
  });

  it('returns 400 if rideId is invalid', async () => {
    const res = await cancelRide('', fakeDynamo);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid or missing rideId' });
  });

  it('returns 409 Conflict when concurrent state update causes conditional put to fail', async () => {
    const rideId = 'ride-race-cancel';
    await createTestRide(rideId, RideState.REQUESTED);

    // Mock conditionalPutItem to return false simulating an optimistic locking race failure
    jest.spyOn(fakeDynamo, 'conditionalPutItem').mockResolvedValueOnce(false);

    const res = await cancelRide(rideId, fakeDynamo);
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toContain(
      'Concurrent state modification detected',
    );
  });
});
