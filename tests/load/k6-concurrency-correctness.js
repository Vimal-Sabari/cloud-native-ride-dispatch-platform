import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * k6 Load Test: Concurrency Correctness (Contention Stress Test)
 *
 * Forces extreme candidate contention to stress-test the claim-then-confirm mechanism (Module 17)
 * and the batch matcher (Module 23).
 *
 * Key Design Elements:
 * 1. DRIVER_COUNT (default 5) is deliberately smaller than REQUEST_COUNT (default 20).
 * 2. All drivers and riders are positioned in a TIGHT 200m circle, maximizing spatial overlap
 *    so every incoming request competes for the exact same drivers in the candidate pool.
 * 3. All REQUEST_COUNT requests are dispatched as simultaneously as possible via shared-iterations.
 * 4. Each VU prints its created rideId with a distinct, greppable prefix:
 *      "[CONCURRENCY_TEST_RIDE] VU=<vu> ITER=<iter> RIDER=<riderId> RIDE_ID=<rideId>"
 *    allowing the post-run script (verify-no-double-bookings.js) to inspect all rides.
 *
 * Configurable via environment variables (__ENV):
 *   BASE_URL      - API Gateway Base URL (default: http://localhost:4566)
 *   AUTH_URL      - Auth Service Base URL (default: http://localhost:4567)
 *   DRIVER_COUNT  - Seeded available drivers (default: 5)
 *   REQUEST_COUNT - Concurrent ride requests (default: 20)
 */

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:4566').replace(/\/$/, '');
const AUTH_URL = (__ENV.AUTH_URL || 'http://localhost:4567').replace(/\/$/, '');
const DRIVER_COUNT = Number(__ENV.DRIVER_COUNT) || 5;
const REQUEST_COUNT = Number(__ENV.REQUEST_COUNT) || 20;

export const options = {
  scenarios: {
    contention_burst: {
      executor: 'shared-iterations',
      vus: REQUEST_COUNT,
      iterations: REQUEST_COUNT,
      maxDuration: '2m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.10'],
  },
};

// Tight 200m radius around Market & 4th St, San Francisco
const CENTER = { lat: 37.7858, lng: -122.4065 };
const TIGHT_RADIUS_METERS = 200;
const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function getRandomPoint(center, radiusMeters) {
  const angle = Math.random() * 2 * Math.PI;
  const r = radiusMeters * Math.sqrt(Math.random());

  const dx = r * Math.cos(angle);
  const dy = r * Math.sin(angle);

  const dLat = (dy / EARTH_RADIUS_METERS) * RAD_TO_DEG;
  const meanLat = center.lat + dLat / 2;
  const cosLat = Math.cos(meanLat * DEG_TO_RAD);
  const dLng = (dx / (EARTH_RADIUS_METERS * cosLat)) * RAD_TO_DEG;

  return {
    lat: Number((center.lat + dLat).toFixed(6)),
    lng: Number((center.lng + dLng).toFixed(6)),
  };
}

/**
 * Setup hook: Establishes DRIVER_COUNT drivers in the tight 200m zone.
 */
export function setup() {
  console.log(`[setup] Seeding ${DRIVER_COUNT} drivers in tight ${TIGHT_RADIUS_METERS}m contention radius...`);
  const drivers = [];

  for (let i = 1; i <= DRIVER_COUNT; i++) {
    const driverId = `contention-driver-${i}-${Date.now()}`;
    const authRes = http.post(
      `${AUTH_URL}/auth/token`,
      JSON.stringify({ subjectId: driverId, role: 'driver' }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (authRes.status !== 200) {
      console.warn(`[setup] Failed to auth driver ${driverId}: ${authRes.status}`);
      continue;
    }

    const token = authRes.json().token;
    const pos = getRandomPoint(CENTER, TIGHT_RADIUS_METERS);

    // 1. Update location
    http.post(
      `${BASE_URL}/drivers/${driverId}/location`,
      JSON.stringify({ lat: pos.lat, lng: pos.lng }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // 2. Set available status
    http.post(
      `${BASE_URL}/drivers/${driverId}/status`,
      JSON.stringify({ status: 'available' }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    drivers.push({ driverId, pos });
  }

  console.log(`[setup] Seeded ${drivers.length} drivers for contention test.`);
  // Wait 3 seconds for DynamoDB Streams -> SQS -> Matching Service GeoIndex sync
  sleep(3);
  return { drivers, center: CENTER };
}

export default function (data) {
  const riderId = `contention-rider-${__VU}-${__ITER}-${Date.now()}`;

  // 1. Authenticate rider
  const authRes = http.post(
    `${AUTH_URL}/auth/token`,
    JSON.stringify({ subjectId: riderId, role: 'rider' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const authOk = check(authRes, { 'rider auth status is 200': (r) => r.status === 200 });
  if (!authOk) return;

  const riderToken = authRes.json().token;

  // 2. Pickup & dropoff within the tight 200m contention zone
  const pickup = getRandomPoint(data.center || CENTER, TIGHT_RADIUS_METERS);
  const dropoff = getRandomPoint(data.center || CENTER, TIGHT_RADIUS_METERS + 800);

  // 3. Post ride request
  const reqRes = http.post(
    `${BASE_URL}/riders/${riderId}/rides`,
    JSON.stringify({ pickup, dropoff }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${riderToken}`,
      },
    }
  );

  const reqOk = check(reqRes, {
    'concurrency ride request accepted': (r) => r.status === 201 || r.status === 200,
  });

  if (!reqOk) return;

  const rideData = reqRes.json();
  const rideId = rideData.rideId;

  if (rideId) {
    // Print tagged output line for post-run correlation script
    console.log(`[CONCURRENCY_TEST_RIDE] VU=${__VU} ITER=${__ITER} RIDER=${riderId} RIDE_ID=${rideId}`);
  }

  // Small pause before completion
  sleep(1);
}
