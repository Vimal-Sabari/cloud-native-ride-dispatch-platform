import { Point, approxDistanceMeters, nextStep, randomStartingPoint } from '../src/movement';

describe('movement module', () => {
  const center: Point = { lat: 37.7749, lng: -122.4194 }; // San Francisco
  const radiusMeters = 3000;
  const stepSizeMeters = 30;
  const floatTolerance = 0.5;


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

  describe('randomStartingPoint (property test)', () => {
    it('generates points strictly within radiusMeters over 1000 random samples', () => {
      const SAMPLES = 1000;
      for (let i = 0; i < SAMPLES; i++) {
        const point = randomStartingPoint(center, radiusMeters);
        const dist = approxDistanceMeters(point, center);
        expect(dist).toBeLessThanOrEqual(radiusMeters + floatTolerance);
      }
    });

    it('produces varied coordinates across samples', () => {
      const p1 = randomStartingPoint(center, radiusMeters);
      const p2 = randomStartingPoint(center, radiusMeters);
      expect(p1.lat !== p2.lat || p1.lng !== p2.lng).toBe(true);
    });
  });

  describe('nextStep (bounded random walk)', () => {
    it('keeps all positions bounded within radiusMeters across 1000 steps', () => {
      // Start near the boundary to stress-test reflections
      let current: Point = randomStartingPoint(center, radiusMeters);
      const STEPS = 1000;

      for (let i = 0; i < STEPS; i++) {
        current = nextStep(current, center, radiusMeters, stepSizeMeters);
        const dist = approxDistanceMeters(current, center);

        // Even with small step overshoot or floating point, position should not
        // exceed radiusMeters by more than the step size plus tolerance
        expect(dist).toBeLessThanOrEqual(radiusMeters + stepSizeMeters + floatTolerance);
      }
    });

    it('changes position by approximately stepSizeMeters on each step', () => {
      const start: Point = { lat: center.lat, lng: center.lng };
      const next = nextStep(start, center, radiusMeters, stepSizeMeters);
      const stepDistance = approxDistanceMeters(start, next);

      // Distance moved should be very close to stepSizeMeters (within 2% tolerance)
      expect(stepDistance).toBeGreaterThanOrEqual(stepSizeMeters * 0.95);
      expect(stepDistance).toBeLessThanOrEqual(stepSizeMeters * 1.05);
      expect(stepDistance).not.toBe(0);
    });

    it('steps back toward center when point is beyond radius', () => {
      // Create a point deliberately outside the boundary
      const outsidePoint: Point = {
        lat: center.lat + 0.05, // ~5.5 km north of center
        lng: center.lng,
      };

      const distBefore = approxDistanceMeters(outsidePoint, center);
      expect(distBefore).toBeGreaterThan(radiusMeters);

      const stepped = nextStep(outsidePoint, center, radiusMeters, stepSizeMeters);
      const distAfter = approxDistanceMeters(stepped, center);

      // Must have stepped closer to center
      expect(distAfter).toBeLessThan(distBefore);
      expect(distBefore - distAfter).toBeCloseTo(stepSizeMeters, 1);
    });
  });
});
