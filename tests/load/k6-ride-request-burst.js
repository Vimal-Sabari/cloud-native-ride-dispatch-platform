import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

/**
 * k6 Load Test: Ride Request Burst
 *
 * Exercises the platform's handling of sudden concurrent ride request spikes:
 * 1. setup(): Creates and positions DRIVER_SETUP_COUNT available drivers within a tight area.
 * 2. default function: Fires BURST_COUNT concurrent ride requests via 'shared-iterations',
 *    polling GET /rides/{id} until reaching MATCHED or timeout.
 * 3. Records custom match success/failure counters and time-to-match latency trends.
 *
 * Configurable via environment variables (__ENV):
 *   BASE_URL           - API Gateway Base URL (default: http://localhost:4566)
 *   AUTH_URL           - Auth Service Base URL (default: http://localhost:4567)
 *   DRIVER_SETUP_COUNT - Number of seed drivers to establish in setup() (default: 20)
 *   BURST_COUNT        - Number of simultaneous ride requests to fire (default: 50)
 */

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:4566').replace(/\/$/, '');
const AUTH_URL = (__ENV.AUTH_URL || 'http://localhost:4567').replace(/\/$/, '');
const DRIVER_SETUP_COUNT = Number(__ENV.DRIVER_SETUP_COUNT) || 20;
const BURST_COUNT = Number(__ENV.BURST_COUNT) || 50;

// Custom Metrics
const matchSuccessCounter = new Counter('ride_match_success_count');
const matchFailureCounter = new Counter('ride_match_failure_count');
const timeToMatchTrend = new Trend('ride_time_to_match_ms');

export const options = {
  scenarios: {
    ride_burst: {
      executor: 'shared-iterations',
      vus: BURST_COUNT,
      iterations: BURST_COUNT,
      maxDuration: '3m',
    },
  },
  thresholds: {
    ride_match_success_count: ['count>0'],
    http_req_failed: ['rate<0.10'],
  },
};

// Center point: San Francisco Downtown
const CENTER = { lat: 37.7749, lng: -122.4194 };
const SETUP_RADIUS_METERS = 1000;
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
 * Setup hook: Pre-seeds available drivers near the operational zone
 * so the burst of ride requests finds nearby supply.
 */
export function setup() {
  console.log(`[setup] Establishing ${DRIVER_SETUP_COUNT} available drivers...`);
  const drivers = [];

  for (let i = 1; i <= DRIVER_SETUP_COUNT; i++) {
    const driverId = `burst-driver-${i}-${Date.now()}`;
    const authRes = http.post(
      `${AUTH_URL}/auth/token`,
      JSON.stringify({ subjectId: driverId, role: 'driver' }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (authRes.status !== 200) {
      console.warn(`[setup] Failed to auth driver ${driverId}: HTTP ${authRes.status}`);
      continue;
    }

    const token = authRes.json().token;
    const pos = getRandomPoint(CENTER, SETUP_RADIUS_METERS);

    // 1. Send location update
    const locRes = http.post(
      `${BASE_URL}/drivers/${driverId}/location`,
      JSON.stringify({ lat: pos.lat, lng: pos.lng }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // 2. Explicitly set status to available
    const statusRes = http.post(
      `${BASE_URL}/drivers/${driverId}/status`,
      JSON.stringify({ status: 'available' }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (locRes.status === 200 && statusRes.status === 200) {
      drivers.push({ driverId, pos, token });
    }
  }

  console.log(`[setup] Successfully established ${drivers.length}/${DRIVER_SETUP_COUNT} drivers.`);
  // Allow 3 seconds for DynamoDB Streams -> SQS -> Matching Service GeoIndex synchronization
  sleep(3);
  return { drivers, center: CENTER };
}

export default function (data) {
  const riderId = `burst-rider-${__VU}-${__ITER}-${Date.now()}`;

  // 1. Authenticate rider
  const authRes = http.post(
    `${AUTH_URL}/auth/token`,
    JSON.stringify({ subjectId: riderId, role: 'rider' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const authOk = check(authRes, { 'rider auth status is 200': (r) => r.status === 200 });
  if (!authOk) {
    matchFailureCounter.add(1);
    return;
  }

  const riderToken = authRes.json().token;

  // 2. Generate pickup near driver cluster and nearby dropoff
  const pickup = getRandomPoint(data.center || CENTER, SETUP_RADIUS_METERS);
  const dropoff = getRandomPoint(data.center || CENTER, SETUP_RADIUS_METERS + 1500);

  const requestStartTime = Date.now();

  // 3. Request ride via Trip Service
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
    'ride request created (201 or 200)': (r) => r.status === 201 || r.status === 200,
  });

  if (!reqOk) {
    matchFailureCounter.add(1);
    return;
  }

  const rideData = reqRes.json();
  const rideId = rideData.rideId;

  if (!rideId) {
    matchFailureCounter.add(1);
    return;
  }

  // 4. Poll GET /rides/{id} with bounded attempts until MATCHED or terminal
  const MAX_POLL_ATTEMPTS = 15;
  let isMatched = false;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    // Wait between polls
    sleep(1.5);

    const pollRes = http.get(`${BASE_URL}/rides/${rideId}`, {
      headers: { Authorization: `Bearer ${riderToken}` },
    });

    if (pollRes.status === 200) {
      const pollData = pollRes.json();
      if (pollData.state === 'MATCHED') {
        const timeToMatchMs = Date.now() - requestStartTime;
        matchSuccessCounter.add(1);
        timeToMatchTrend.add(timeToMatchMs);
        isMatched = true;
        break;
      } else if (pollData.state === 'CANCELLED' || pollData.state === 'COMPLETED') {
        break;
      }
    }
  }

  if (!isMatched) {
    matchFailureCounter.add(1);
  }
}
