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

  it('throws error when LOCATION_SERVICE_BASE_URL is missing', () => {
    delete process.env.LOCATION_SERVICE_BASE_URL;
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566';
    expect(() => loadConfig()).toThrow('LOCATION_SERVICE_BASE_URL');
  });

  it('throws error when AUTH_SERVICE_BASE_URL is missing', () => {
    process.env.LOCATION_SERVICE_BASE_URL = 'http://localhost:4566';
    delete process.env.AUTH_SERVICE_BASE_URL;
    expect(() => loadConfig()).toThrow('AUTH_SERVICE_BASE_URL');
  });

  it('loads defaults for optional variables', () => {
    process.env.LOCATION_SERVICE_BASE_URL = 'http://localhost:4566/location/';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth/';
    delete process.env.DRIVER_COUNT;
    delete process.env.CITY_CENTER_LAT;
    delete process.env.CITY_CENTER_LNG;
    delete process.env.AREA_RADIUS_METERS;
    delete process.env.MIN_UPDATE_INTERVAL_MS;
    delete process.env.MAX_UPDATE_INTERVAL_MS;

    const config = loadConfig();
    expect(config.driverCount).toBe(5);
    expect(config.cityCenterLat).toBe(37.7749);
    expect(config.cityCenterLng).toBe(-122.4194);
    expect(config.areaRadiusMeters).toBe(3000);
    expect(config.minUpdateIntervalMs).toBe(1000);
    expect(config.maxUpdateIntervalMs).toBe(2000);
    expect(config.locationServiceBaseUrl).toBe('http://localhost:4566/location');
    expect(config.authServiceBaseUrl).toBe('http://localhost:4566/auth');
  });

  it('parses custom overrides correctly', () => {
    process.env.LOCATION_SERVICE_BASE_URL = 'http://localhost:4566/loc';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth';
    process.env.DRIVER_COUNT = '10';
    process.env.CITY_CENTER_LAT = '40.7128';
    process.env.CITY_CENTER_LNG = '-74.0060';
    process.env.AREA_RADIUS_METERS = '5000';
    process.env.MIN_UPDATE_INTERVAL_MS = '500';
    process.env.MAX_UPDATE_INTERVAL_MS = '1500';

    const config = loadConfig();
    expect(config.driverCount).toBe(10);
    expect(config.cityCenterLat).toBe(40.7128);
    expect(config.cityCenterLng).toBe(-74.006);
    expect(config.areaRadiusMeters).toBe(5000);
    expect(config.minUpdateIntervalMs).toBe(500);
    expect(config.maxUpdateIntervalMs).toBe(1500);
  });

  it('throws error for invalid intervals', () => {
    process.env.LOCATION_SERVICE_BASE_URL = 'http://localhost:4566/loc';
    process.env.AUTH_SERVICE_BASE_URL = 'http://localhost:4566/auth';
    process.env.MIN_UPDATE_INTERVAL_MS = '2000';
    process.env.MAX_UPDATE_INTERVAL_MS = '1000';

    expect(() => loadConfig()).toThrow('cannot be less than MIN_UPDATE_INTERVAL_MS');
  });
});
