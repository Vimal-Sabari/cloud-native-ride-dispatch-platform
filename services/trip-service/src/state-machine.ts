/**
 * State machine governing Ride lifecycle transitions.
 *
 * Lifecycle Transitions:
 * - REQUESTED      -> [MATCHED, CANCELLED]
 * - MATCHED        -> [DRIVER_EN_ROUTE, CANCELLED]
 * - DRIVER_EN_ROUTE -> [IN_PROGRESS, CANCELLED]
 * - IN_PROGRESS    -> [COMPLETED]
 * - COMPLETED      -> [] (terminal state)
 * - CANCELLED      -> [] (terminal state)
 */

import { RideState } from '@ride-dispatch/models';

export const ALLOWED_TRANSITIONS: Record<RideState, RideState[]> = {
  [RideState.REQUESTED]: [RideState.MATCHED, RideState.CANCELLED],
  [RideState.MATCHED]: [RideState.DRIVER_EN_ROUTE, RideState.CANCELLED],
  [RideState.DRIVER_EN_ROUTE]: [RideState.IN_PROGRESS, RideState.CANCELLED],
  [RideState.IN_PROGRESS]: [RideState.COMPLETED],
  [RideState.COMPLETED]: [],
  [RideState.CANCELLED]: [],
};

/**
 * Returns true if transition from `from` state to `to` state is valid according to the state machine.
 */
export function canTransition(from: RideState, to: RideState): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.includes(to);
}
