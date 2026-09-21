import { nextPollDelayMs, INITIAL_POLL_DELAY_MS, MAX_POLL_DELAY_MS } from '../src/polling';

describe('polling module', () => {
  describe('nextPollDelayMs', () => {
    it('is strictly increasing early on: nextPollDelayMs(0) < nextPollDelayMs(1) < nextPollDelayMs(2)', () => {
      const delay0 = nextPollDelayMs(0);
      const delay1 = nextPollDelayMs(1);
      const delay2 = nextPollDelayMs(2);
      const delay3 = nextPollDelayMs(3);

      expect(delay0).toBe(INITIAL_POLL_DELAY_MS); // 500
      expect(delay1).toBe(1000);
      expect(delay2).toBe(2000);
      expect(delay3).toBe(4000);

      expect(delay0).toBeLessThan(delay1);
      expect(delay1).toBeLessThan(delay2);
      expect(delay2).toBeLessThan(delay3);
    });

    it('never exceeds the documented cap (5000ms) even for a large attempt number like 20', () => {
      expect(nextPollDelayMs(4)).toBe(MAX_POLL_DELAY_MS);
      expect(nextPollDelayMs(5)).toBe(MAX_POLL_DELAY_MS);
      expect(nextPollDelayMs(10)).toBe(MAX_POLL_DELAY_MS);
      expect(nextPollDelayMs(20)).toBe(MAX_POLL_DELAY_MS);
      expect(nextPollDelayMs(50)).toBe(MAX_POLL_DELAY_MS);

      for (let attempt = 0; attempt <= 30; attempt++) {
        expect(nextPollDelayMs(attempt)).toBeLessThanOrEqual(MAX_POLL_DELAY_MS);
      }
    });

    it('returns INITIAL_POLL_DELAY_MS for negative attempt indices', () => {
      expect(nextPollDelayMs(-1)).toBe(INITIAL_POLL_DELAY_MS);
    });
  });
});
