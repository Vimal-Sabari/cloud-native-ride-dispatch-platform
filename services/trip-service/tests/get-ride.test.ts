import { RideState } from '@ride-dispatch/models';
import { getRide } from '../src/handlers/get-ride';
import { FakeDynamoAccessor } from './helpers/fake-dynamo';

describe('getRide handler', () => {
  let fakeDynamo: FakeDynamoAccessor;

  beforeEach(() => {
    fakeDynamo = new FakeDynamoAccessor();
  });

  it('returns 200 with ride object when ride exists', async () => {
    const rideId = 'ride-xyz-1';
    const rideRecord = {
      PK: `RIDE#${rideId}`,
      SK: 'DETAILS',
      rideId,
      riderId: 'rider-1',
      state: RideState.REQUESTED,
      pickup: { lat: 37.77, lng: -122.41 },
      dropoff: { lat: 37.78, lng: -122.42 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await fakeDynamo.putItem(rideRecord);

    const res = await getRide(rideId, fakeDynamo);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(rideRecord);
  });

  it('returns 404 when ride is not found', async () => {
    const res = await getRide('non-existent-ride', fakeDynamo);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Ride non-existent-ride not found' });
  });

  it('returns 400 when rideId is empty or whitespace', async () => {
    const res = await getRide('   ', fakeDynamo);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid or missing rideId' });
  });
});
