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

  const now = new Date().toISOString();
  const updatedRide: Record<string, unknown> = {
    ...currentRide,
    state: RideState.CANCELLED,
    updatedAt: now,
  };

  // 2. Perform conditional update ensuring state hasn't changed concurrently
  const condition = `state = ${currentState}`;
  const success = await deps.conditionalPutItem(updatedRide, condition);

  if (!success) {
    return {
      statusCode: 409,
      body: {
        error: `Concurrent state modification detected on ride ${rideId}. State was modified prior to cancellation.`,
      },
    };
  }

  return {
    statusCode: 200,
    body: updatedRide,
  };
}
