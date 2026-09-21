/**
 * Rider Simulator CLI Entrypoint.
 *
 * Spawns concurrent rider simulation loops, requests rides against the deployed
 * Trip Service, polls for status transitions, and coordinates graceful shutdown.
 */

import { loadConfig } from './config';
import { runRiderLoop } from './rider-loop';

export const RIDER_SIMULATOR_NAME = '@ride-dispatch/rider-simulator';

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('       RIDE DISPATCH PLATFORM - RIDER SIMULATOR (CLI)');
  console.log('================================================================');

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Configuration Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`Riders Count:        ${config.riderCount}`);
  console.log(`Area Center:         (${config.areaCenterLat}, ${config.areaCenterLng})`);
  console.log(`Area Radius:         ${config.areaRadiusMeters} meters`);
  console.log(
    `Request Interval:    ${config.minRequestIntervalMs}ms - ${config.maxRequestIntervalMs}ms`,
  );
  console.log(`Max Poll Attempts:   ${config.maxPollAttempts}`);
  console.log(`Trip Base URL:       ${config.tripServiceBaseUrl}`);
  console.log(`Auth Base URL:       ${config.authServiceBaseUrl}`);
  console.log('----------------------------------------------------------------');
  console.log('NOTE: Until Matching Service (Modules 17-18) is deployed, rides');
  console.log('will remain in REQUESTED state. Polling will log "still PENDING".');
  console.log('----------------------------------------------------------------');
  console.log('Press Ctrl+C to stop simulation gracefully.\n');

  const abortController = new AbortController();
  const { signal } = abortController;

  const riderPromises: Promise<void>[] = [];
  for (let i = 1; i <= config.riderCount; i++) {
    const riderId = `sim-rider-${i}`;
    riderPromises.push(runRiderLoop(riderId, config, signal));
  }

  let isShuttingDown = false;
  const handleShutdown = async (signalName: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\nReceived ${signalName}. Initiating graceful shutdown...`);
    abortController.abort();

    // Wait up to 5 seconds for rider loops to cleanly exit
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([Promise.allSettled(riderPromises), timeout]);

    console.log('All riders stopped. Simulator exited cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void handleShutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void handleShutdown('SIGTERM');
  });

  try {
    await Promise.all(riderPromises);
  } catch (err) {
    console.error('Unexpected error in rider simulation loop:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
