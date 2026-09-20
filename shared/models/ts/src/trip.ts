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
