/**
 * Handler for cancelling a ride.
 *
 * Design Decision on HTTP Status:
 * Returns HTTP 409 Conflict when state transition preconditions fail (e.g. attempting to cancel
 * a ride in COMPLETED or CANCELLED status, or losing a concurrent write race).
 * 409 Conflict is semantically superior to 400 Bad Request because the request payload itself is
 * syntactically valid, but the target resource's current state prohibits the requested mutation.
 */

import { RideState } from '@ride-dispatch/models';
import { DynamoAccessor } from '../dynamo-accessor';
import { canTransition } from '../state-machine';

export async function cancelRide(
  rideId: string,
  deps: DynamoAccessor,
): Promise<{ statusCode: number; body: unknown }> {
  if (!rideId || typeof rideId !== 'string' || rideId.trim() === '') {
    return {
      statusCode: 400,
      body: { error: 'Invalid or missing rideId' },
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

  // 1. Verify state machine allows transition to CANCELLED
  if (!canTransition(currentState, RideState.CANCELLED)) {
    return {
      statusCode: 409,
      body: {
        error: `Cannot transition ride ${rideId} from state '${currentState}' to 'CANCELLED'`,
      },
    };
  }

  // 2. Perform conditional update ensuring state hasn't changed concurrently
  try {
    let condition = '#state = :requested';
    if (currentState === RideState.MATCHED) {
      condition = '#state = :matched';
    } else if (currentState === RideState.DRIVER_EN_ROUTE) {
      condition = '#state = :driver_en_route';
    }

    const updatedRide = await deps.updateRide(
      rideId.trim(),
      { state: RideState.CANCELLED },
      condition,
    );

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
          message: 'Ride is no longer cancellable',
          error: `Concurrent state modification detected on ride ${rideId}. State was modified prior to cancellation.`,
        },
      };
    }
    throw error;
  }
}
