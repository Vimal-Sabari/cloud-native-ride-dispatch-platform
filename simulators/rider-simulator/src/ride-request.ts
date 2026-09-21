/**
 * Pure geospatial point generation and ride request payload construction for Rider Simulator.
 *
 * ARCHITECTURAL NOTES:
 * 1. Minimal Self-Contained Model:
 *    The `Point` interface is deliberately duplicated here rather than importing
 *    from `shared/models/ts`. This keeps the simulator lightweight, autonomous, and free
 *    of workspace dependency coupling.
 * 2. Uniform Disc Sampling & Flat-Earth Equirectangular Approximation:
 *    This module uses standard uniform disc sampling ($r = R \sqrt{U}, \theta = 2\pi V$)
 *    and a planar equirectangular distance approximation ($R = 6,371,000\text{m}$)
 *    matching the driver simulator's `movement.ts`. This small piece of math is duplicated
 *    intentionally because simulator testing and movement logic have different performance
 *    and precision characteristics than the core production geospatial Go library.
 */

export interface Point {
  lat: number;
  lng: number;
}

export interface RideRequestPayload {
  pickup: Point;
  dropoff: Point;
}

const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Minimum threshold distance in meters between pickup and dropoff points.
 * Trips under this distance are considered degenerate near-zero-distance requests.
 */
export const MIN_TRIP_DISTANCE_METERS = 200;

/**
 * Computes the approximate Euclidean distance in meters between two points
 * using the equirectangular projection centered on the mean latitude.
 */
export function approxDistanceMeters(p1: Point, p2: Point): number {
  const dLatRad = (p2.lat - p1.lat) * DEG_TO_RAD;
  const dLngRad = (p2.lng - p1.lng) * DEG_TO_RAD;
  const meanLatRad = ((p1.lat + p2.lat) / 2) * DEG_TO_RAD;

  const x = dLngRad * Math.cos(meanLatRad) * EARTH_RADIUS_METERS;
  const y = dLatRad * EARTH_RADIUS_METERS;

  return Math.sqrt(x * x + y * y);
}

/**
 * Generates a uniformly distributed random point within a circular disk
 * of radiusMeters centered at `center`.
 *
 * Employs $r = \text{radius} \times \sqrt{U}$ to ensure equal probability density
 * per unit of surface area.
 */
export function randomPointInArea(center: Point, radiusMeters: number): Point {
  const angle = Math.random() * 2 * Math.PI;
  const r = radiusMeters * Math.sqrt(Math.random());

  const dx = r * Math.cos(angle);
  const dy = r * Math.sin(angle);

  const dLat = (dy / EARTH_RADIUS_METERS) * RAD_TO_DEG;
  const meanLat = center.lat + dLat / 2;
  const cosLat = Math.cos(meanLat * DEG_TO_RAD);
  const dLng = (dx / (EARTH_RADIUS_METERS * cosLat)) * RAD_TO_DEG;

  return {
    lat: center.lat + dLat,
    lng: center.lng + dLng,
  };
}


/**
 * Generates a ride request comprising independent pickup and dropoff points
 * within the specified operational area.
 *
 * SAFEGUARD NOTE:
 * If pickup and dropoff happen to fall within `MIN_TRIP_DISTANCE_METERS` (~200m),
 * dropoff is regenerated to prevent degenerate near-zero-distance trips.
 */
export function generateRideRequest(center: Point, radiusMeters: number): RideRequestPayload {
  const pickup = randomPointInArea(center, radiusMeters);
  let dropoff = randomPointInArea(center, radiusMeters);

  let attempts = 0;
  while (approxDistanceMeters(pickup, dropoff) < MIN_TRIP_DISTANCE_METERS && attempts < 5) {
    dropoff = randomPointInArea(center, radiusMeters);
    attempts++;
  }

  return { pickup, dropoff };
}

