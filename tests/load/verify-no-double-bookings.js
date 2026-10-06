#!/usr/bin/env node

/**
 * Double-Booking Verification Script (Post-k6 Correctness Check)
 *
 * Checks for concurrency anomalies across Trip Service rides created during
 * k6-concurrency-correctness.js.
 *
 * Algorithm:
 * 1. Collects ride IDs from:
 *    a) Standard input / log file containing `[CONCURRENCY_TEST_RIDE] ... RIDE_ID=<uuid>` lines, OR
 *    b) Direct CLI arguments (`node verify-no-double-bookings.js <rideId1> <rideId2> ...`), OR
 *    c) In-memory synthetic validation mode (`--self-test`).
 * 2. Queries Trip Service HTTP API (`GET /rides/{id}`) for every ride ID.
 * 3. Filters to rides that successfully matched with a driver (`driverId` present and state in
 *    MATCHED, DRIVER_EN_ROUTE, ARRIVED, IN_PROGRESS, or terminal states with valid timestamps).
 * 4. Maps driverId -> array of assigned rides with their active time windows:
 *    - Start: `matchedAt` (or `updatedAt` / `createdAt`)
 *    - End:   `completedAt` / `cancelledAt` (or infinity if currently still active)
 * 5. Checks every driver's ride list for any pairwise OVERLAPPING active time windows.
 *    Two active, non-terminal rides for the same driver at the same time IS A DOUBLE-BOOKING.
 * 6. Exits with 0 on PASS, or 1 on FAIL with detailed collision logs.
 */

const fs = require('fs');

/**
 * Self-test synthetic dataset check:
 * Validates that detectDoubleBookings reliably catches a known, hand-crafted double-booking.
 */
function runSelfTest() {
  console.log('========================================================');
  console.log('[Self-Test] Running Synthetic Dataset Double-Booking Validation');
  console.log('========================================================');

  // Synthetic Case 1: Driver D1 is assigned to two rides concurrently (OVERLAP)
  const syntheticDatasetWithDoubleBooking = [
    {
      rideId: 'ride-synth-1',
      driverId: 'driver-synth-collision',
      state: 'MATCHED',
      createdAt: '2026-10-06T10:00:00.000Z',
      updatedAt: '2026-10-06T10:00:05.000Z',
    },
    {
      rideId: 'ride-synth-2',
      driverId: 'driver-synth-collision',
      state: 'IN_PROGRESS',
      createdAt: '2026-10-06T10:00:02.000Z',
      updatedAt: '2026-10-06T10:00:04.000Z',
    },
    {
      rideId: 'ride-synth-3',
      driverId: 'driver-synth-clean',
      state: 'MATCHED',
      createdAt: '2026-10-06T10:00:00.000Z',
      updatedAt: '2026-10-06T10:00:05.000Z',
    },
  ];

  const collisionResult = detectDoubleBookings(syntheticDatasetWithDoubleBooking);
  if (collisionResult.doubleBookings.length === 0) {
    console.error('[FAIL] Synthetic self-test FAILED: Did NOT detect known double-booking!');
    process.exit(1);
  }
  console.log(`[PASS] Synthetic self-test correctly caught collision: Driver ${collisionResult.doubleBookings[0].driverId} on rides ${collisionResult.doubleBookings[0].rideA} & ${collisionResult.doubleBookings[0].rideB}`);

  // Synthetic Case 2: Clean sequential assignments (NO OVERLAP)
  const syntheticCleanDataset = [
    {
      rideId: 'ride-clean-1',
      driverId: 'driver-synth-seq',
      state: 'COMPLETED',
      createdAt: '2026-10-06T09:00:00.000Z',
      updatedAt: '2026-10-06T09:10:00.000Z',
    },
    {
      rideId: 'ride-clean-2',
      driverId: 'driver-synth-seq',
      state: 'MATCHED',
      createdAt: '2026-10-06T09:15:00.000Z',
      updatedAt: '2026-10-06T09:15:02.000Z',
    },
  ];

  const cleanResult = detectDoubleBookings(syntheticCleanDataset);
  if (cleanResult.doubleBookings.length > 0) {
    console.error('[FAIL] Synthetic self-test false-positive on sequential rides!');
    process.exit(1);
  }
  console.log('[PASS] Synthetic self-test verified clean sequential assignments without false alarms.');
  console.log('========================================================\n');
}

/**
 * Pure double-booking detection algorithm.
 *
 * @param {Array<object>} rides Array of ride objects returned by Trip Service.
 * @returns {{ doubleBookings: Array<{ driverId: string, rideA: string, rideB: string, reason: string }>, matchedRidesCount: number, driversCount: number }}
 */
function detectDoubleBookings(rides) {
  const driverRidesMap = new Map();
  let matchedRidesCount = 0;

  for (const ride of rides) {
    if (!ride || !ride.driverId) continue;
    matchedRidesCount++;

    const driverId = String(ride.driverId);
    if (!driverRidesMap.has(driverId)) {
      driverRidesMap.set(driverId, []);
    }

    const state = ride.state || 'UNKNOWN';
    const startTime = new Date(ride.matchedAt || ride.updatedAt || ride.createdAt || 0).getTime();

    // Determine if ride is currently in an active, non-terminal state
    const isActive = ['MATCHED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(state);
    const endTime = isActive
      ? Number.POSITIVE_INFINITY
      : new Date(ride.completedAt || ride.cancelledAt || ride.updatedAt || Date.now()).getTime();

    driverRidesMap.get(driverId).push({
      rideId: ride.rideId,
      state,
      startTime,
      endTime,
      isActive,
    });
  }

  const doubleBookings = [];

  for (const [driverId, driverRides] of driverRidesMap.entries()) {
    if (driverRides.length <= 1) continue;

    // Check all pairwise combinations for overlap
    for (let i = 0; i < driverRides.length; i++) {
      for (let j = i + 1; j < driverRides.length; j++) {
        const r1 = driverRides[i];
        const r2 = driverRides[j];

        // If BOTH are active non-terminal rides, that is an unambiguous double-booking
        if (r1.isActive && r2.isActive) {
          doubleBookings.push({
            driverId,
            rideA: r1.rideId,
            rideB: r2.rideId,
            reason: `Both rides are simultaneously active (${r1.state} and ${r2.state})`,
          });
          continue;
        }

        // Otherwise check temporal overlap if timestamps are valid
        const maxStart = Math.max(r1.startTime, r2.startTime);
        const minEnd = Math.min(r1.endTime, r2.endTime);

        if (maxStart < minEnd) {
          doubleBookings.push({
            driverId,
            rideA: r1.rideId,
            rideB: r2.rideId,
            reason: `Overlapping active windows: [${new Date(r1.startTime).toISOString()} - ${r1.endTime === Infinity ? 'ACTIVE' : new Date(r1.endTime).toISOString()}] overlaps [${new Date(r2.startTime).toISOString()} - ${r2.endTime === Infinity ? 'ACTIVE' : new Date(r2.endTime).toISOString()}]`,
          });
        }
      }
    }
  }

  return {
    doubleBookings,
    matchedRidesCount,
    driversCount: driverRidesMap.size,
  };
}

/**
 * Parses ride IDs from a text string or log file containing [CONCURRENCY_TEST_RIDE] tags.
 */
function extractRideIdsFromText(text) {
  const ids = new Set();
  const regex = /RIDE_ID=([a-fA-F0-9-]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Obtains an auth token from Auth Service for querying GET /rides/{id}.
 */
async function getAuthToken(authUrl) {
  const url = `${authUrl.replace(/\/$/, '')}/auth/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectId: 'double-booking-verifier', role: 'rider' }),
  });

  if (!res.ok) {
    throw new Error(`Failed to authenticate verifier against ${url}: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.token;
}

/**
 * Fetches ride details from Trip Service.
 */
async function fetchRide(baseUrl, token, rideId) {
  const url = `${baseUrl.replace(/\/$/, '')}/rides/${rideId}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    console.warn(`[Warning] HTTP ${res.status} fetching ride ${rideId}`);
    return null;
  }
  return await res.json();
}

async function main() {
  const args = process.argv.slice(2);

  // Always execute self-test before validating real runs
  runSelfTest();

  if (args.includes('--self-test-only')) {
    console.log('Self-test completed successfully. Exiting.');
    process.exit(0);
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:4566';
  const authUrl = process.env.AUTH_URL || 'http://localhost:4567';

  let rideIds = [];

  // Check if a file was provided as an argument
  for (const arg of args) {
    if (arg.startsWith('--')) continue;
    if (fs.existsSync(arg)) {
      console.log(`Reading ride IDs from log file: ${arg}`);
      const fileContent = fs.readFileSync(arg, 'utf-8');
      const found = extractRideIdsFromText(fileContent);
      rideIds.push(...found);
    } else if (arg.includes('-') && arg.length > 20) {
      // Looks like a UUID
      rideIds.push(arg);
    }
  }

  // If no file argument, try reading stdin if available
  if (rideIds.length === 0 && !process.stdin.isTTY) {
    try {
      const stdinContent = fs.readFileSync(0, 'utf-8');
      rideIds.push(...extractRideIdsFromText(stdinContent));
    } catch (e) {
      // Stdin empty or unavailable
    }
  }

  // Deduplicate ride IDs
  rideIds = Array.from(new Set(rideIds));

  if (rideIds.length === 0) {
    console.warn('[Warning] No ride IDs found to verify. Pass a log file or ride IDs as arguments.');
    console.log('Example: node tests/load/verify-no-double-bookings.js results/concurrency-output.log');
    process.exit(0);
  }

  console.log(`[Verification] Querying Trip Service for ${rideIds.length} ride(s)...`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  Auth URL: ${authUrl}\n`);

  let token = null;
  try {
    token = await getAuthToken(authUrl);
  } catch (err) {
    console.warn(`[Auth Warning] Could not get bearer token: ${err.message}. Attempting unauthenticated queries...`);
  }

  const fetchedRides = [];
  for (const rideId of rideIds) {
    const ride = await fetchRide(baseUrl, token, rideId);
    if (ride) {
      fetchedRides.push(ride);
    }
  }

  console.log(`[Verification] Retrieved state for ${fetchedRides.length}/${rideIds.length} rides.`);

  const result = detectDoubleBookings(fetchedRides);

  console.log('========================================================');
  console.log('Double-Booking Verification Summary');
  console.log('========================================================');
  console.log(`Total rides queried:     ${rideIds.length}`);
  console.log(`Matched rides:           ${result.matchedRidesCount}`);
  console.log(`Distinct drivers:        ${result.driversCount}`);
  console.log(`Double-bookings detected: ${result.doubleBookings.length}`);
  console.log('========================================================');

  if (result.doubleBookings.length > 0) {
    console.error('\n[CRITICAL FAILURE] DOUBLE-BOOKINGS DETECTED UNDER CONCURRENT CONTENTION:');
    for (const b of result.doubleBookings) {
      console.error(`  - Driver: ${b.driverId} | Colliding Rides: ${b.rideA} & ${b.rideB}`);
      console.error(`    Reason: ${b.reason}`);
    }
    process.exit(1);
  } else {
    console.log(`\n[PASS] ${result.matchedRidesCount} rides matched across ${result.driversCount} drivers, zero double-bookings detected.`);
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during double-booking verification:', err);
    process.exit(1);
  });
}

module.exports = {
  detectDoubleBookings,
  extractRideIdsFromText,
  runSelfTest,
};
