/**
 * Handler for listing all rides requested by a rider.
 *
 * Queries GSI2 (GSI2PK = RIDER#<riderId>) and returns records ordered
 * most-recent-first (GSI2SK descending).
 */

import { DynamoAccessor } from '../dynamo-accessor';

export async function listRiderRides(
  riderId: string,
  deps: DynamoAccessor,
): Promise<{ statusCode: number; body: unknown }> {
  if (!riderId || typeof riderId !== 'string' || riderId.trim() === '') {
    return {
      statusCode: 400,
      body: { error: 'Invalid or missing riderId' },
    };
  }

  const gsi2pk = `RIDER#${riderId.trim()}`;
  const items = await deps.query({
    indexName: 'GSI2',
    keyConditionExpression: 'GSI2PK = :gsi2pk',
    expressionAttributeValues: {
      ':gsi2pk': gsi2pk,
    },
  });

  // Sort most-recent-first by GSI2SK descending (format: RIDE#<createdAt>#<rideId>)
  items.sort((a, b) => {
    const skA = typeof a.GSI2SK === 'string' ? a.GSI2SK : '';
    const skB = typeof b.GSI2SK === 'string' ? b.GSI2SK : '';
    return skB.localeCompare(skA);
  });

  return {
    statusCode: 200,
    body: items,
  };
}
