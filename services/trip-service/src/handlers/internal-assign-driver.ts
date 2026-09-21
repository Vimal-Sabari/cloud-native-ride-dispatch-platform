/**
 * Internal handler for assigning a matched driver to a ride.
 *
 * Security Note:
 * This endpoint is invoked internally by the matching service (EC2 daemon) rather than
 * via rider/driver JWTs. It verifies incoming requests using an `x-internal-api-key` header
 * matching `process.env.INTERNAL_API_KEY`.
 */

import { RideState } from '@ride-dispatch/models';
import { DynamoAccessor } from '../dynamo-accessor';
import { canTransition } from '../state-machine';

function extractApiKey(headers?: Record<string, string | undefined>): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-internal-api-key') {
      return value?.trim();
    }
  }
  return undefined;
}

export async function assignDriver(
  rideId: string,
  driverId: string,
  depsOrHeaders: DynamoAccessor | Record<string, string | undefined>,
  optionalDepsOrHeaders?: DynamoAccessor | Record<string, string | undefined>,
): Promise<{ statusCode: number; body: unknown }> {
  // Disambiguate flexible argument order: (rideId, driverId, deps, headers) or (rideId, driverId, headers, deps)
  let deps: DynamoAccessor;
  let headers: Record<string, string | undefined> | undefined;

  if (depsOrHeaders && 'getItem' in depsOrHeaders) {
    deps = depsOrHeaders as DynamoAccessor;
    headers = optionalDepsOrHeaders as Record<string, string | undefined> | undefined;
  } else {
    headers = depsOrHeaders as Record<string, string | undefined> | undefined;
    deps = optionalDepsOrHeaders as DynamoAccessor;
  }

  // 1. Verify internal API key before any state machine or data-access logic
  const apiKey = extractApiKey(headers);
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return {
      statusCode: 401,
      body: { error: 'Unauthorized: invalid or missing x-internal-api-key header' },
    };
  }

  if (!rideId || typeof rideId !== 'string' || rideId.trim() === '') {
    return {
      statusCode: 400,
      body: { error: 'Invalid or missing rideId' },
    };
  }

  if (!driverId || typeof driverId !== 'string' || driverId.trim() === '') {
    return {
      statusCode: 400,
      body: { error: 'Invalid or missing driverId' },
    };
  }

  const pk = `RIDE#${rideId.trim()}`;
  const currentRide = await deps.getItem(pk, 'DETAILS');

  if (!currentRide) {
    return {
      statusCode: 404,
      body: { error: `Ride ${rideId} not found` },
    };
  }

  const currentState = currentRide.state as RideState;

  // 2. Validate state machine transition to MATCHED
  if (!canTransition(currentState, RideState.MATCHED)) {
    return {
      statusCode: 409,
      body: {
        error: `Cannot transition ride ${rideId} from state '${currentState}' to 'MATCHED'`,
      },
    };
  }

  // 3. Atomically update state to MATCHED and driverId asserting active REQUESTED state
  try {
    const updatedRide = await deps.updateRide(
      rideId.trim(),
      {
        state: RideState.MATCHED,
        driverId: driverId.trim(),
      },
      '#state = :requested',
    );

    // 4. Overwrite GSI3 active ride pointer for the driver
    // Architecture Note:
    // In a full production system requiring multi-entity consistency, this write would be
    // grouped with step 3 using DynamoDB TransactWriteItems. A sequential two-step write is
    // an accepted and documented simplification for this single-table design.
    const now = new Date().toISOString();
    const driverPointerItem: Record<string, unknown> = {
      PK: `DRIVER#${driverId.trim()}`,
      SK: 'ACTIVE_RIDE_POINTER',
      GSI3PK: `DRIVER#${driverId.trim()}`,
      GSI3SK: 'ACTIVE_RIDE',
      rideId: rideId.trim(),
      createdAt: now,
      updatedAt: now,
    };

    await deps.putItem(driverPointerItem);

    return {
      statusCode: 200,
      body: updatedRide,
    };
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === 'object' &&
      (('name' in error && (error as { name: string }).name === 'ConditionalCheckFailedException') ||
        ('__type' in error && (error as { __type: string }).__type.endsWith('ConditionalCheckFailedException')))
    ) {
      return {
        statusCode: 409,
        body: {
          message: 'Ride is no longer assignable',
          error: `Concurrent state modification detected on ride ${rideId}. Driver assignment aborted.`,
        },
      };
    }
    throw error;
  }
}

export const internalAssignDriver = assignDriver;
