import { RideState } from '@ride-dispatch/models';
import { cancelRide } from '../src/handlers/cancel-ride';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('cancelRide handler', () => {
  let fakeDynamo: FakeDynamoAccessor;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
  });

  const createTestRide = async (rideId: string, state: RideState) => {
    const item = {
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
