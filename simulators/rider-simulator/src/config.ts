/**
 * Configuration loader for the Rider Simulator CLI.
 * Reads environment variables with sensible defaults for simulation parameters,
 * while strictly requiring endpoint URLs to prevent silent misconfigurations.
 */

export interface Config {
  riderCount: number;
  areaCenterLat: number;
  areaCenterLng: number;
  areaRadiusMeters: number;
  tripServiceBaseUrl: string;
  authServiceBaseUrl: string;
  minRequestIntervalMs: number;
  maxRequestIntervalMs: number;
  maxPollAttempts: number;
}

/**
 * Loads configuration from environment variables.
 *
 * Environment Variables:
 * - RIDER_COUNT: Number of concurrent riders to simulate (default: 3)
 * - AREA_CENTER_LAT: Latitude of simulation area center (default: 37.7749, San Francisco)
 * - AREA_CENTER_LNG: Longitude of simulation area center (default: -122.4194, San Francisco)
 * - AREA_RADIUS_METERS: Operational radius in meters around center (default: 3000)
 * - TRIP_SERVICE_BASE_URL: [REQUIRED] Base URL for Trip Service API Gateway endpoints
 *   (e.g., http://localhost:4566/restapis/<id>/local/_user_request_ from `terraform output api_gateway_invoke_url`)
 * - AUTH_SERVICE_BASE_URL: [REQUIRED] Base URL for Auth Stub API Gateway endpoints
 *   (typically the same API Gateway invoke URL exposing POST /auth/token)
 * - MIN_REQUEST_INTERVAL_MS: Minimum interval between ride request cycles in ms (default: 5000)
 * - MAX_REQUEST_INTERVAL_MS: Maximum interval between ride request cycles in ms (default: 10000)
 * - MAX_POLL_ATTEMPTS: Maximum status polling attempts before giving up on a ride (default: 15)
 */
export function loadConfig(): Config {
  const tripServiceBaseUrl = process.env.TRIP_SERVICE_BASE_URL?.trim();
  if (!tripServiceBaseUrl) {
    throw new Error(
      'Missing required environment variable: TRIP_SERVICE_BASE_URL. ' +
        'Set this to the API Gateway invoke URL output by Terraform ' +
        '(e.g., http://localhost:4566/restapis/<id>/local/_user_request_).',
    );
  }

  const authServiceBaseUrl = process.env.AUTH_SERVICE_BASE_URL?.trim();
  if (!authServiceBaseUrl) {
    throw new Error(
      'Missing required environment variable: AUTH_SERVICE_BASE_URL. ' +
        'Set this to the Base URL of the Auth Service / API Gateway exposing POST /auth/token.',
    );
  }

  const parseNumber = (value: string | undefined, defaultValue: number, name: string): number => {
    if (value === undefined || value.trim() === '') {
      return defaultValue;
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`Invalid numeric value for environment variable ${name}: "${value}"`);
    }
    return num;
  };

  const riderCount = parseNumber(process.env.RIDER_COUNT, 3, 'RIDER_COUNT');
  if (riderCount <= 0 || !Number.isInteger(riderCount)) {
    throw new Error('RIDER_COUNT must be a positive integer');
  }

  // Support AREA_CENTER_LAT with fallback to CITY_CENTER_LAT for cross-simulator consistency
  const rawLat = process.env.AREA_CENTER_LAT ?? process.env.CITY_CENTER_LAT;
  const areaCenterLat = parseNumber(rawLat, 37.7749, 'AREA_CENTER_LAT');
  if (areaCenterLat < -90 || areaCenterLat > 90) {
    throw new Error('AREA_CENTER_LAT must be between -90 and 90 degrees');
  }

  // Support AREA_CENTER_LNG with fallback to CITY_CENTER_LNG for cross-simulator consistency
  const rawLng = process.env.AREA_CENTER_LNG ?? process.env.CITY_CENTER_LNG;
  const areaCenterLng = parseNumber(rawLng, -122.4194, 'AREA_CENTER_LNG');
  if (areaCenterLng < -180 || areaCenterLng > 180) {
    throw new Error('AREA_CENTER_LNG must be between -180 and 180 degrees');
  }

  const areaRadiusMeters = parseNumber(process.env.AREA_RADIUS_METERS, 3000, 'AREA_RADIUS_METERS');
  if (areaRadiusMeters <= 0) {
    throw new Error('AREA_RADIUS_METERS must be greater than 0');
  }

  const minRequestIntervalMs = parseNumber(
    process.env.MIN_REQUEST_INTERVAL_MS,
    5000,
    'MIN_REQUEST_INTERVAL_MS',
  );
  if (minRequestIntervalMs <= 0) {
    throw new Error('MIN_REQUEST_INTERVAL_MS must be greater than 0');
  }

  const maxRequestIntervalMs = parseNumber(
    process.env.MAX_REQUEST_INTERVAL_MS,
    10000,
    'MAX_REQUEST_INTERVAL_MS',
  );
  if (maxRequestIntervalMs < minRequestIntervalMs) {
    throw new Error(
      `MAX_REQUEST_INTERVAL_MS (${maxRequestIntervalMs}) cannot be less than MIN_REQUEST_INTERVAL_MS (${minRequestIntervalMs})`,
    );
  }

  const maxPollAttempts = parseNumber(process.env.MAX_POLL_ATTEMPTS, 15, 'MAX_POLL_ATTEMPTS');
  if (maxPollAttempts <= 0 || !Number.isInteger(maxPollAttempts)) {
    throw new Error('MAX_POLL_ATTEMPTS must be a positive integer');
  }

  return {
    riderCount,
    areaCenterLat,
    areaCenterLng,
    areaRadiusMeters,
    tripServiceBaseUrl: tripServiceBaseUrl.replace(/\/+$/, ''),
    authServiceBaseUrl: authServiceBaseUrl.replace(/\/+$/, ''),
    minRequestIntervalMs,
    maxRequestIntervalMs,
    maxPollAttempts,
  };
}
