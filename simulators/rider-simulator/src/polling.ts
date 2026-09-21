/**
 * Polling backoff utility for the Rider Simulator.
 * Computes exponential backoff delays with an upper bound for status polling.
 */

export const INITIAL_POLL_DELAY_MS = 500;
export const MAX_POLL_DELAY_MS = 5000;

/**
 * Calculates the polling delay for a given attempt index using bounded exponential backoff.
 *
 * Pattern:
 * - Attempt 0: 500ms
 * - Attempt 1: 1000ms
 * - Attempt 2: 2000ms
 * - Attempt 3: 4000ms
 * - Attempt 4+: 5000ms (capped)
 *
 * @param attempt - 0-based polling attempt counter
 * @returns Delay in milliseconds, capped at `MAX_POLL_DELAY_MS`
 */
export function nextPollDelayMs(attempt: number): number {
  if (attempt < 0) {
    return INITIAL_POLL_DELAY_MS;
  }
  // Safeguard against large exponents producing Infinity
  if (attempt > 30) {
    return MAX_POLL_DELAY_MS;
  }
  return Math.min(INITIAL_POLL_DELAY_MS * 2 ** attempt, MAX_POLL_DELAY_MS);
}
