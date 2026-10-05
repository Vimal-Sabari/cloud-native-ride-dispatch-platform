/**
 * Trip and Ride domain models for Ride Dispatch Platform.
 */

export enum RideState {
  REQUESTED = 'REQUESTED',
  MATCHED = 'MATCHED',
  DRIVER_EN_ROUTE = 'DRIVER_EN_ROUTE',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/**
 * State machine allowed transitions.
 * NOTE: The MATCHED -> REQUESTED transition is reserved EXCLUSIVELY for the system-initiated
 * stale-match-reassignment path (Module 27) — no rider-facing or driver-facing handler should
 * ever request this transition directly.
 */
export const ALLOWED_TRANSITIONS: Record<RideState, RideState[]> = {
  [RideState.REQUESTED]: [RideState.MATCHED, RideState.CANCELLED],
  // The MATCHED -> REQUESTED transition is reserved EXCLUSIVELY for the system-initiated
  // stale-match-reassignment path (Module 27) — no rider-facing or driver-facing handler
  // should ever request this transition directly.
  [RideState.MATCHED]: [RideState.DRIVER_EN_ROUTE, RideState.CANCELLED, RideState.REQUESTED],
  [RideState.DRIVER_EN_ROUTE]: [RideState.IN_PROGRESS, RideState.CANCELLED],
  [RideState.IN_PROGRESS]: [RideState.COMPLETED],
  [RideState.COMPLETED]: [],
  [RideState.CANCELLED]: [],
};

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Ride {
  rideId: string;
  riderId: string;
  driverId?: string;
  state: RideState;
  pickup: Coordinates;
  dropoff: Coordinates;
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
}

export interface RequestRideBody {
  pickup: Coordinates;
  dropoff: Coordinates;
  idempotencyKey?: string;
}
