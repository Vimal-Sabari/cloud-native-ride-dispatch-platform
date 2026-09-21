import { loadConfig } from '../src/config';

describe('config module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws error when TRIP_SERVICE_BASE_URL is missing', () => {
    delete process.env.TRIP_SERVICE_BASE_URL;
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566';
    expect(() => loadConfig()).toThrow('TRIP_SERVICE_BASE_URL');
  });

  it('throws error when AUTH_SERVICE_BASE_URL is missing', () => {
    process.env.TRIP_SERVICE_BASE_URL = 'http://localhost:4566';
    delete process.env.AUTH_SERVICE_BASE_URL;
    expect(() => loadConfig()).toThrow('AUTH_SERVICE_BASE_URL');
  });

  it('loads defaults for optional variables', () => {
    process.env.TRIP_SERVICE_BASE_URL = 'http://localhost:4566/trips/';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth/';
    delete process.env.RIDER_COUNT;
    delete process.env.AREA_CENTER_LAT;
    delete process.env.AREA_CENTER_LNG;
    delete process.env.CITY_CENTER_LAT;
    delete process.env.CITY_CENTER_LNG;
    delete process.env.AREA_RADIUS_METERS;
    delete process.env.MIN_REQUEST_INTERVAL_MS;
    delete process.env.MAX_REQUEST_INTERVAL_MS;
    delete process.env.MAX_POLL_ATTEMPTS;

    const config = loadConfig();
    expect(config.riderCount).toBe(3);
    expect(config.areaCenterLat).toBe(37.7749);
    expect(config.areaCenterLng).toBe(-122.4194);
    expect(config.areaRadiusMeters).toBe(3000);
    expect(config.minRequestIntervalMs).toBe(5000);
    expect(config.maxRequestIntervalMs).toBe(10000);
    expect(config.maxPollAttempts).toBe(15);
    expect(config.tripServiceBaseUrl).toBe('http://localhost:4566/trips');
    expect(config.authServiceBaseUrl).toBe('http://localhost:4566/auth');
  });

  it('parses custom overrides correctly', () => {
    process.env.TRIP_SERVICE_BASE_URL = 'http://localhost:4566/trips';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth';
    process.env.RIDER_COUNT = '8';
    process.env.AREA_CENTER_LAT = '40.7128';
    process.env.AREA_CENTER_LNG = '-74.0060';
    process.env.AREA_RADIUS_METERS = '4500';
    process.env.MIN_REQUEST_INTERVAL_MS = '2000';
    process.env.MAX_REQUEST_INTERVAL_MS = '4000';
    process.env.MAX_POLL_ATTEMPTS = '20';

    const config = loadConfig();
    expect(config.riderCount).toBe(8);
    expect(config.areaCenterLat).toBe(40.7128);
    expect(config.areaCenterLng).toBe(-74.006);
    expect(config.areaRadiusMeters).toBe(4500);
    expect(config.minRequestIntervalMs).toBe(2000);
    expect(config.maxRequestIntervalMs).toBe(4000);
    expect(config.maxPollAttempts).toBe(20);
  });

  it('falls back to CITY_CENTER_LAT and CITY_CENTER_LNG when AREA_CENTER_* are unset', () => {
    process.env.TRIP_SERVICE_BASE_URL = 'http://localhost:4566/trips';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth';
    delete process.env.AREA_CENTER_LAT;
    delete process.env.AREA_CENTER_LNG;
    process.env.CITY_CENTER_LAT = '34.0522';
    process.env.CITY_CENTER_LNG = '-118.2437';

    const config = loadConfig();
    expect(config.areaCenterLat).toBe(34.0522);
    expect(config.areaCenterLng).toBe(-118.2437);
  });

  it('throws error for invalid intervals where max < min', () => {
    process.env.TRIP_SERVICE_BASE_URL = 'http://localhost:4566/trips';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth';
    process.env.MIN_REQUEST_INTERVAL_MS = '5000';
    process.env.MAX_REQUEST_INTERVAL_MS = '2000';

    expect(() => loadConfig()).toThrow('cannot be less than MIN_REQUEST_INTERVAL_MS');
  });

  it('throws error for invalid numeric values', () => {
    process.env.TRIP_SERVICE_BASE_URL = 'http://localhost:4566/trips';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth';
    process.env.RIDER_COUNT = 'not-a-number';

    expect(() => loadConfig()).toThrow('Invalid numeric value');
  });
});
