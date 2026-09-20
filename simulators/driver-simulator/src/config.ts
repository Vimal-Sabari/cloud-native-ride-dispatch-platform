/**
 * Configuration loader for the Driver Simulator CLI.
 * Reads environment variables with sensible defaults for simulation parameters,
 * while strictly requiring endpoint URLs to prevent silent misconfigurations.
 */

export interface Config {
  driverCount: number;
  cityCenterLat: number;
  cityCenterLng: number;
  areaRadiusMeters: number;
  locationServiceBaseUrl: string;
  authServiceBaseUrl: string;
  minUpdateIntervalMs: number;
  maxUpdateIntervalMs: number;
}

/**
 * Loads configuration from environment variables.
 *
 * Environment Variables:
 * - DRIVER_COUNT: Number of concurrent drivers to simulate (default: 5)
 * - CITY_CENTER_LAT: Latitude of simulation area center (default: 37.7749, San Francisco)
 * - CITY_CENTER_LNG: Longitude of simulation area center (default: -122.4194, San Francisco)
 * - AREA_RADIUS_METERS: Operational radius in meters around center (default: 3000)
 * - LOCATION_SERVICE_BASE_URL: [REQUIRED] Base URL for Location Service API Gateway endpoints
 *   (e.g., http://localhost:4566/restapis/<rest_api_id>/local/_user_request_ from `terraform output api_gateway_invoke_url`)
 * - AUTH_SERVICE_BASE_URL: [REQUIRED] Base URL for Auth Stub API Gateway endpoints
 *   (typically the same API Gateway invoke URL or dedicated auth endpoint exposing POST /auth/token)
 * - MIN_UPDATE_INTERVAL_MS: Minimum interval between location updates per driver in ms (default: 1000)
 * - MAX_UPDATE_INTERVAL_MS: Maximum interval between location updates per driver in ms (default: 2000)
 */
export function loadConfig(): Config {
  const locationServiceBaseUrl = process.env.LOCATION_SERVICE_BASE_URL?.trim();
  if (!locationServiceBaseUrl) {
    throw new Error(
      'Missing required environment variable: LOCATION_SERVICE_BASE_URL. ' +
        'Set this to the API Gateway invoke URL output by Terraform after Module 10 apply ' +
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

  const driverCount = parseNumber(process.env.DRIVER_COUNT, 5, 'DRIVER_COUNT');
  if (driverCount <= 0 || !Number.isInteger(driverCount)) {
    throw new Error('DRIVER_COUNT must be a positive integer');
  }

  const cityCenterLat = parseNumber(process.env.CITY_CENTER_LAT, 37.7749, 'CITY_CENTER_LAT');
  if (cityCenterLat < -90 || cityCenterLat > 90) {
    throw new Error('CITY_CENTER_LAT must be between -90 and 90 degrees');
  }

  const cityCenterLng = parseNumber(process.env.CITY_CENTER_LNG, -122.4194, 'CITY_CENTER_LNG');
  if (cityCenterLng < -180 || cityCenterLng > 180) {
    throw new Error('CITY_CENTER_LNG must be between -180 and 180 degrees');
  }

  const areaRadiusMeters = parseNumber(process.env.AREA_RADIUS_METERS, 3000, 'AREA_RADIUS_METERS');
  if (areaRadiusMeters <= 0) {
    throw new Error('AREA_RADIUS_METERS must be greater than 0');
  }

  const minUpdateIntervalMs = parseNumber(
    process.env.MIN_UPDATE_INTERVAL_MS,
    1000,
    'MIN_UPDATE_INTERVAL_MS',
  );
  if (minUpdateIntervalMs <= 0) {
    throw new Error('MIN_UPDATE_INTERVAL_MS must be greater than 0');
  }

  const maxUpdateIntervalMs = parseNumber(
    process.env.MAX_UPDATE_INTERVAL_MS,
    2000,
    'MAX_UPDATE_INTERVAL_MS',
  );
  if (maxUpdateIntervalMs < minUpdateIntervalMs) {
    throw new Error(
      `MAX_UPDATE_INTERVAL_MS (${maxUpdateIntervalMs}) cannot be less than MIN_UPDATE_INTERVAL_MS (${minUpdateIntervalMs})`,
    );
  }

  return {
    driverCount,
    cityCenterLat,
    cityCenterLng,
    areaRadiusMeters,
    locationServiceBaseUrl: locationServiceBaseUrl.replace(/\/+$/, ''),
    authServiceBaseUrl: authServiceBaseUrl.replace(/\/+$/, ''),
    minUpdateIntervalMs,
    maxUpdateIntervalMs,
  };
}
