/**
 * Handler for retrieving a single ride by ID.
 */

import { DynamoAccessor } from '../dynamo-accessor';

export async function getRide(
  rideId: string,
  deps: DynamoAccessor,
): Promise<{ statusCode: number; body: unknown }> {
  if (!rideId || typeof rideId !== 'string' || rideId.trim() === '') {
    return {
      statusCode: 400,
      body: { error: 'Invalid or missing rideId' },
    };
  }

  const ride = await deps.getItem(`RIDE#${rideId.trim()}`, 'DETAILS');

  if (!ride) {
    return {
      statusCode: 404,
      body: { error: `Ride ${rideId} not found` },
    };
  }

  return {
    statusCode: 200,
    body: ride,
  };
}
