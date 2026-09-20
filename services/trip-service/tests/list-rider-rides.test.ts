import { RideState } from '@ride-dispatch/models';
import { listRiderRides } from '../src/handlers/list-rider-rides';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('listRiderRides handler', () => {
  let fakeDynamo: FakeDynamoAccessor;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
  });

  it('returns 200 with empty array when rider has no rides', async () => {
    const res = await listRiderRides('rider-empty', fakeDynamo);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns rides sorted descending by timestamp (most-recent-first)', async () => {
    const riderId = 'rider-multi';

    const rideOld = {
      PK: 'RIDE#ride-1',
      SK: 'DETAILS',
      GSI2PK: `RIDER#${riderId}`,
      GSI2SK: 'RIDE#2026-09-18T12:00:00.000Z#ride-1',
      rideId: 'ride-1',
      riderId,
      state: RideState.COMPLETED,
    };

    const rideMid = {
      PK: 'RIDE#ride-2',
      SK: 'DETAILS',
      GSI2PK: `RIDER#${riderId}`,
      GSI2SK: 'RIDE#2026-09-19T15:00:00.000Z#ride-2',
      rideId: 'ride-2',
      riderId,
      state: RideState.COMPLETED,
    };

    const rideNew = {
      PK: 'RIDE#ride-3',
      SK: 'DETAILS',
      GSI2PK: `RIDER#${riderId}`,
      GSI2SK: 'RIDE#2026-09-20T09:00:00.000Z#ride-3',
      rideId: 'ride-3',
      riderId,
      state: RideState.REQUESTED,
    };

    // Also seed a ride for another rider to verify isolation
    const rideOther = {
      PK: 'RIDE#ride-4',
      SK: 'DETAILS',
      GSI2PK: 'RIDER#rider-other',
      GSI2SK: 'RIDE#2026-09-20T10:00:00.000Z#ride-4',
      rideId: 'ride-4',
      riderId: 'rider-other',
      state: RideState.REQUESTED,
    };

    fakeDynamo.seed([rideOld, rideMid, rideNew, rideOther]);

    const res = await listRiderRides(riderId, fakeDynamo);
    expect(res.statusCode).toBe(200);

    const rides = res.body as Record<string, unknown>[];
    expect(rides).toHaveLength(3);
    // Most-recent-first order: ride-3, ride-2, ride-1
    expect(rides[0].rideId).toBe('ride-3');
    expect(rides[1].rideId).toBe('ride-2');
    expect(rides[2].rideId).toBe('ride-1');
  });

  it('returns 400 for empty or invalid riderId', async () => {
    const res = await listRiderRides('   ', fakeDynamo);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid or missing riderId' });
  });
});
