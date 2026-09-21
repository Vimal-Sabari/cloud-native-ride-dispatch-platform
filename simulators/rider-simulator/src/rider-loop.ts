/**
 * Rider simulation loop.
 * Simulates a single rider requesting rides and polling for status updates
 * against the deployed Trip Service API Gateway.
 */

import { Config } from './config';
import { Point, generateRideRequest } from './ride-request';
import { TokenCache } from './auth';
import { nextPollDelayMs } from './polling';

/**
 * Returns a promise that resolves after the specified duration in ms,
 * or immediately if the abort signal fires.
 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
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
export function getJitteredInterval(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

interface RideResponse {
  rideId?: string;
  state?: string;
  driverId?: string;
}

/**
 * Runs the simulation loop for a single rider until the abort signal is triggered.
 *
 * Each cycle:
 * 1. Obtains a cached/refreshed JWT token with `role: "rider"`.
 * 2. Generates a random ride request payload (pickup/dropoff in operational area).
 * 3. Sends POST /riders/{riderId}/rides.
 * 4. Polls GET /rides/{rideId} up to config.maxPollAttempts using exponential backoff.
 * 5. Logs terminal states (COMPLETED/CANCELLED) or explicitly logs when polling exhausts
 *    ("still PENDING after N attempts (expected until Matching Service exists)").
 * 6. Waits a jittered interval between MIN_REQUEST_INTERVAL_MS and MAX_REQUEST_INTERVAL_MS
 *    before starting the next cycle.
 */
export async function runRiderLoop(
  riderId: string,
  config: Config,
  signal: AbortSignal,
): Promise<void> {
  const tokenCache = new TokenCache(config.authServiceBaseUrl, riderId);
  const center: Point = {
    lat: config.areaCenterLat,
    lng: config.areaCenterLng,
  };

  let cycle = 0;
  while (!signal.aborted) {
    cycle++;
    try {
      // 1. Obtain JWT token
      const token = await tokenCache.getToken();
      if (signal.aborted) break;

      // 2. Generate random ride request coordinates
      const payload = generateRideRequest(center, config.areaRadiusMeters);

      // 3. Request ride via Trip Service
      const reqUrl = `${config.tripServiceBaseUrl}/riders/${riderId}/rides`;
      const res = await fetch(reqUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.warn(
          `[${riderId}] [WARNING] Failed to request ride (HTTP ${res.status} ${res.statusText}): ${errorText}`,
        );
        await abortableSleep(
          getJitteredInterval(config.minRequestIntervalMs, config.maxRequestIntervalMs),
          signal,
        );
        continue;
      }

      const rideData = (await res.json()) as RideResponse;
      const rideId = rideData.rideId;
      if (!rideId) {
        console.warn(`[${riderId}] [WARNING] Trip Service response missing valid rideId`);
        await abortableSleep(
          getJitteredInterval(config.minRequestIntervalMs, config.maxRequestIntervalMs),
          signal,
        );
        continue;
      }

      console.log(
        `[${riderId}] Ride requested: ${rideId} | Pickup: (${payload.pickup.lat.toFixed(4)}, ${payload.pickup.lng.toFixed(4)}) -> Dropoff: (${payload.dropoff.lat.toFixed(4)}, ${payload.dropoff.lng.toFixed(4)})`,
      );

      // 4. Poll GET /rides/{rideId} up to config.maxPollAttempts
      let isTerminal = false;
      let lastState = rideData.state || 'REQUESTED';

      for (let attempt = 0; attempt < config.maxPollAttempts && !signal.aborted; attempt++) {
        const delayMs = nextPollDelayMs(attempt);
        await abortableSleep(delayMs, signal);
        if (signal.aborted) break;

        try {
          const pollUrl = `${config.tripServiceBaseUrl}/rides/${rideId}`;
          const pollRes = await fetch(pollUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!pollRes.ok) {
            console.warn(
              `[${riderId}] [WARNING] Poll attempt ${attempt + 1}/${config.maxPollAttempts} failed (HTTP ${pollRes.status}): ${pollRes.statusText}`,
            );
            continue;
          }

          const pollData = (await pollRes.json()) as RideResponse;
          lastState = pollData.state || lastState;

          if (lastState === 'COMPLETED' || lastState === 'CANCELLED') {
            console.log(`[${riderId}] Ride ${rideId} reached terminal state: ${lastState}`);
            isTerminal = true;
            break;
          } else if (lastState !== 'REQUESTED') {
            console.log(
              `[${riderId}] Ride ${rideId} progressed to state: ${lastState}${pollData.driverId ? ` (Driver: ${pollData.driverId})` : ''}`,
            );
          }
        } catch (pollErr) {
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
          console.warn(`[${riderId}] [WARNING] Poll attempt ${attempt + 1} network error: ${msg}`);
        }
      }

      // 5. Handle polling outcome
      if (!isTerminal && !signal.aborted) {
        console.log(
          `[${riderId}] Ride ${rideId} still PENDING after ${config.maxPollAttempts} attempts (expected until Matching Service exists). Last state: ${lastState}`,
        );
      }
    } catch (cycleErr) {
      const msg = cycleErr instanceof Error ? cycleErr.message : String(cycleErr);
      console.warn(`[${riderId}] [WARNING] Error during rider cycle ${cycle}: ${msg}`);
    }

    // 6. Sleep jittered interval before next ride request
    if (!signal.aborted) {
      const waitMs = getJitteredInterval(config.minRequestIntervalMs, config.maxRequestIntervalMs);
      console.log(`[${riderId}] Waiting ${waitMs}ms before requesting next ride...`);
      await abortableSleep(waitMs, signal);
    }
  }

  console.log(`[${riderId}] Rider loop gracefully exited.`);
}
