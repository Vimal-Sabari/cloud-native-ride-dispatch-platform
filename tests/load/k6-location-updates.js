import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * k6 Load Test: Sustained Driver Location Updates
 *
 * Simulates concurrent active drivers continuously transmitting GPS telemetry
 * to Location Service (POST /drivers/{id}/location).
 *
 * Configurable via environment variables (__ENV):
 *   BASE_URL     - Base URL for Location Service / API Gateway (default: http://localhost:4566)
 *   AUTH_URL     - Base URL for Auth Service (default: http://localhost:4567)
 *   DRIVER_COUNT - Number of concurrent driver VUs (default: 100)
 *   DURATION     - Duration of the sustained test (default: '2m')
 */

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:4566').replace(/\/$/, '');
const AUTH_URL = (__ENV.AUTH_URL || 'http://localhost:4567').replace(/\/$/, '');
const DRIVER_COUNT = Number(__ENV.DRIVER_COUNT) || 100;
const DURATION = __ENV.DURATION || '2m';

export const options = {
  scenarios: {
    drivers: {
      executor: 'constant-vus',
      vus: DRIVER_COUNT,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'], // Under 5% errors
    http_req_duration: ['p(95)<1000'], // 95% of requests under 1s
  },
};

// Center point: San Francisco Downtown
const CENTER = { lat: 37.7749, lng: -122.4194 };
const RADIUS_METERS = 5000;
const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Generates a uniform random coordinate within a circular radius around center.
 */
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

// In k6, per-VU state persists across iterations of the same VU
let authToken = null;
let driverId = null;

export default function () {
  // 1. On first iteration of this virtual user, obtain JWT from Auth Stub
  if (!authToken) {
    driverId = `k6-driver-${__VU}`;
    const authRes = http.post(
      `${AUTH_URL}/auth/token`,
      JSON.stringify({
        subjectId: driverId,
        role: 'driver',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const authSuccess = check(authRes, {
      'auth token received': (r) => r.status === 200,
    });

    if (!authSuccess) {
      // Retry authentication next iteration if auth service was temporarily unreachable
      sleep(1);
      return;
    }

    try {
      const data = authRes.json();
      authToken = data.token;
    } catch (e) {
      sleep(1);
      return;
    }
  }

  // 2. Generate plausible random location coordinate
  const pos = getRandomPoint(CENTER, RADIUS_METERS);

  // 3. Post telemetry heartbeat to Location Service
  const locRes = http.post(
    `${BASE_URL}/drivers/${driverId}/location`,
    JSON.stringify({
      lat: pos.lat,
      lng: pos.lng,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  check(locRes, {
    'location update status is 200': (r) => r.status === 200,
  });

  // 4. Jittered sleep 1-2 seconds between telemetry pings
  sleep(1 + Math.random());
}
