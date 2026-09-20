/**
 * Driver simulation loop.
 * Continuously simulates a single driver's movement and status updates
 * against the Location Service API Gateway.
 */

import { Config } from './config';
import { Point, nextStep, randomStartingPoint } from './movement';
import { TokenCache } from './auth';

/**
 * Returns a promise that resolves after the specified duration in ms,
 * or immediately if the abort signal fires.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Generates a random jittered duration between minMs and maxMs.
 */
function getJitteredInterval(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

/**
 * Runs the simulation loop for a single driver until the abort signal is triggered.
 *
 * Each iteration:
 * 1. Obtains a cached/refreshed JWT token.
 * 2. Sends POST /drivers/{driverId}/location with lat/lng.
 * 3. Periodically sends POST /drivers/{driverId}/status toggling between available and busy.
 * 4. Computes the next bounded random walk step.
 * 5. Sleeps for a jittered interval between MIN_UPDATE_INTERVAL_MS and MAX_UPDATE_INTERVAL_MS.
 */
export async function runDriverLoop(
  driverId: string,
  config: Config,
  signal: AbortSignal,
): Promise<void> {
  const tokenCache = new TokenCache(config.authServiceBaseUrl, driverId);
  const center: Point = {
    lat: config.cityCenterLat,
    lng: config.cityCenterLng,
  };

  let currentPos = randomStartingPoint(center, config.areaRadiusMeters);
  let currentStatus: 'available' | 'busy' = 'available';
  let iteration = 0;
  const stepSizeMeters = 30; // ~30m per update represents realistic urban vehicle travel

  while (!signal.aborted) {
    iteration++;
    const intervalMs = getJitteredInterval(config.minUpdateIntervalMs, config.maxUpdateIntervalMs);

    try {
      const token = await tokenCache.getToken();

      // 1. Send Location Update
      const locUrl = `${config.locationServiceBaseUrl}/drivers/${driverId}/location`;
      const locRes = await fetch(locUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lat: currentPos.lat,
          lng: currentPos.lng,
        }),
      });

      const locOk = locRes.ok ? 'OK' : `FAIL (${locRes.status})`;

      // 2. Periodically send Status Update (on first iteration and roughly every 15-20 iterations)
      let statusLog = '';
      if (iteration === 1 || iteration % 18 === 0) {
        if (iteration > 1) {
          currentStatus = currentStatus === 'available' ? 'busy' : 'available';
        }

        const statusUrl = `${config.locationServiceBaseUrl}/drivers/${driverId}/status`;
        const statusRes = await fetch(statusUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: currentStatus,
          }),
        });

        statusLog = ` | Status Update: ${currentStatus} (${statusRes.status} ${statusRes.statusText})`;
      }

      console.log(
        `[${driverId}] Location: (${currentPos.lat.toFixed(5)}, ${currentPos.lng.toFixed(5)}) | HTTP ${locRes.status} ${locOk}${statusLog} | Next: ${intervalMs}ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${driverId}] [WARNING] Update failed: ${message}. Retrying next iteration.`);
    }

    // 3. Compute next step for next iteration
    currentPos = nextStep(currentPos, center, config.areaRadiusMeters, stepSizeMeters);

    // 4. Jittered sleep until next update
    await abortableSleep(intervalMs, signal);
  }

  console.log(`[${driverId}] Driver loop gracefully exited.`);
}
