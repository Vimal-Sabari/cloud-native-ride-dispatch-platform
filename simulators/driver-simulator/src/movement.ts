/**
 * Pure geospatial movement functions for the Driver Simulator.
 *
 * ARCHITECTURAL NOTE:
 * This module intentionally uses a simple equirectangular flat-Earth projection
 * approximation (R = 6,371,000m) rather than the production Go geospatial library
 * (shared/geospatial). The simulator's goal is generating realistic random walk
 * movement across small urban radii (e.g. 1-10km), where high-precision geodesic
 * calculations (Haversine/Vincenty) are unnecessary overhead.
 */

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

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
 * Generates a uniformly distributed random starting point within a circular
 * disk of radiusMeters around the center point.
 * Uses the standard r = R * sqrt(U) method for uniform areal distribution.
 */
export function randomStartingPoint(center: Point, radiusMeters: number): Point {
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
 * Computes the next position for a driver using a bounded random walk.
 *
 * Moves the current position by a step of `stepSizeMeters` in a random direction.
 * If the resulting point would exceed `radiusMeters` from `center`, the driver
 * instead steps directly back toward `center` to reflect/bound movement within
 * the operational area.
 */
export function nextStep(
  current: Point,
  center: Point,
  radiusMeters: number,
  stepSizeMeters: number,
): Point {
  // 1. Candidate step in a uniformly random direction
  const angle = Math.random() * 2 * Math.PI;
  const dx = stepSizeMeters * Math.cos(angle);
  const dy = stepSizeMeters * Math.sin(angle);

  const dLat = (dy / EARTH_RADIUS_METERS) * RAD_TO_DEG;
  const cosLat = Math.cos(current.lat * DEG_TO_RAD);
  const dLng = (dx / (EARTH_RADIUS_METERS * cosLat)) * RAD_TO_DEG;

  const candidate: Point = {
    lat: current.lat + dLat,
    lng: current.lng + dLng,
  };

  // 2. Check if candidate remains within the bounded operational radius
  const candDist = approxDistanceMeters(candidate, center);
  if (candDist <= radiusMeters) {
    return candidate;
  }

  // 3. Otherwise, step back toward the center point
  const distToCenter = approxDistanceMeters(current, center);
  if (distToCenter === 0) {
    return current;
  }

  const actualStep = Math.min(stepSizeMeters, distToCenter);
  const dLatRad = (center.lat - current.lat) * DEG_TO_RAD;
  const dLngRad = (center.lng - current.lng) * DEG_TO_RAD;
  const meanLatRad = ((current.lat + center.lat) / 2) * DEG_TO_RAD;

  const xCenter = dLngRad * Math.cos(meanLatRad) * EARTH_RADIUS_METERS;
  const yCenter = dLatRad * EARTH_RADIUS_METERS;
  const norm = Math.sqrt(xCenter * xCenter + yCenter * yCenter);

  const stepX = (xCenter / norm) * actualStep;
  const stepY = (yCenter / norm) * actualStep;

  const stepLat = (stepY / EARTH_RADIUS_METERS) * RAD_TO_DEG;
  const stepLng = (stepX / (EARTH_RADIUS_METERS * Math.cos(current.lat * DEG_TO_RAD))) * RAD_TO_DEG;

  return {
    lat: current.lat + stepLat,
    lng: current.lng + stepLng,
  };
}
