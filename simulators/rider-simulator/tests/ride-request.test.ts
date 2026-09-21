import {
  Point,
  approxDistanceMeters,
  randomPointInArea,
  generateRideRequest,
  MIN_TRIP_DISTANCE_METERS,
} from '../src/ride-request';

describe('ride-request module', () => {
  const center: Point = { lat: 37.7749, lng: -122.4194 }; // San Francisco
  const radiusMeters = 3000;
  const floatTolerance = 0.5; // 0.5m tolerance accommodates coordinate floating point precision


  describe('approxDistanceMeters', () => {
    it('returns 0 distance when measuring a point to itself', () => {
      const dist = approxDistanceMeters(center, center);
      expect(dist).toBeCloseTo(0, 5);
    });

    it('is symmetric between two points', () => {
      const p1: Point = { lat: 37.7749, lng: -122.4194 };
      const p2: Point = { lat: 37.7849, lng: -122.4094 };
      expect(approxDistanceMeters(p1, p2)).toBeCloseTo(approxDistanceMeters(p2, p1), 5);
    });
  });

  describe('randomPointInArea (property test)', () => {
    it('generates points strictly within radiusMeters over 1000 random samples', () => {
      const SAMPLES = 1000;
      for (let i = 0; i < SAMPLES; i++) {
        const point = randomPointInArea(center, radiusMeters);
        const dist = approxDistanceMeters(point, center);
        expect(dist).toBeLessThanOrEqual(radiusMeters + floatTolerance);
      }
    });

    it('produces varied coordinates across samples', () => {
      const p1 = randomPointInArea(center, radiusMeters);
      const p2 = randomPointInArea(center, radiusMeters);
      expect(p1.lat !== p2.lat || p1.lng !== p2.lng).toBe(true);
    });
  });

  describe('generateRideRequest', () => {
    it('generates pickup and dropoff points within radiusMeters across 1000 samples', () => {
      const SAMPLES = 1000;
      for (let i = 0; i < SAMPLES; i++) {
        const { pickup, dropoff } = generateRideRequest(center, radiusMeters);

        const pickupDist = approxDistanceMeters(pickup, center);
        const dropoffDist = approxDistanceMeters(dropoff, center);

        expect(pickupDist).toBeLessThanOrEqual(radiusMeters + floatTolerance);
        expect(dropoffDist).toBeLessThanOrEqual(radiusMeters + floatTolerance);
      }
    });

    it('asserts pickup and dropoff are never within the near-zero-distance threshold after the regeneration safeguard', () => {
      const SAMPLES = 1000;
      for (let i = 0; i < SAMPLES; i++) {
        const { pickup, dropoff } = generateRideRequest(center, radiusMeters);
        const tripDist = approxDistanceMeters(pickup, dropoff);

        // Distance between pickup and dropoff must be at least MIN_TRIP_DISTANCE_METERS
        expect(tripDist).toBeGreaterThanOrEqual(MIN_TRIP_DISTANCE_METERS - floatTolerance);
      }
    });
  });
});
