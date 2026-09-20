/**
 * Driver Simulator CLI Entrypoint.
 *
 * Spawns concurrent driver simulation loops, updates location/status continuously
 * against the deployed Location Service, and coordinates graceful shutdown.
 */

import { loadConfig } from './config';
import { runDriverLoop } from './driver-loop';

export const DRIVER_SIMULATOR_NAME = '@ride-dispatch/driver-simulator';

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('       RIDE DISPATCH PLATFORM - DRIVER SIMULATOR (CLI)');
  console.log('================================================================');

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Configuration Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`Drivers Count:       ${config.driverCount}`);
  console.log(`City Center:         (${config.cityCenterLat}, ${config.cityCenterLng})`);
  console.log(`Area Radius:         ${config.areaRadiusMeters} meters`);
  console.log(
    `Update Interval:     ${config.minUpdateIntervalMs}ms - ${config.maxUpdateIntervalMs}ms`,
  );
  console.log(`Location Base URL:   ${config.locationServiceBaseUrl}`);
  console.log(`Auth Base URL:       ${config.authServiceBaseUrl}`);
  console.log('----------------------------------------------------------------');
  console.log('Press Ctrl+C to stop simulation gracefully.');
  console.log('----------------------------------------------------------------\n');

  const abortController = new AbortController();
  const { signal } = abortController;

  const driverPromises: Promise<void>[] = [];
  for (let i = 1; i <= config.driverCount; i++) {
    const driverId = `sim-driver-${i}`;
    driverPromises.push(runDriverLoop(driverId, config, signal));
  }

  let isShuttingDown = false;
  const handleShutdown = async (signalName: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\nReceived ${signalName}. Initiating graceful shutdown...`);
    abortController.abort();

    // Wait up to 5 seconds for driver loops to finish current iteration
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([Promise.allSettled(driverPromises), timeout]);

    console.log('All drivers stopped. Simulator exited cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void handleShutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void handleShutdown('SIGTERM');
  });

  try {
    await Promise.all(driverPromises);
  } catch (err) {
    console.error('Unexpected error in simulation loop:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
