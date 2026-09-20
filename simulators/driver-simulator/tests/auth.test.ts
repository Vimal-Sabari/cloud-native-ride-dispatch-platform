import { TokenCache } from '../src/auth';

describe('auth TokenCache', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createTestJwt(expSecondsFromNow: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
    const payload = Buffer.from(JSON.stringify({ sub: 'driver-1', role: 'driver', exp })).toString(
      'base64url',
    );
    const sig = 'test-signature';
    return `${header}.${payload}.${sig}`;
  }

  it('fetches a token and caches it', async () => {
    const fakeToken = createTestJwt(3600); // 1 hour
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: fakeToken }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const cache = new TokenCache('http://auth-stub:4566', 'driver-1');

    const token1 = await cache.getToken();
    expect(token1).toBe(fakeToken);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Subsequent call should use cache without invoking fetch again
    const token2 = await cache.getToken();
    expect(token2).toBe(fakeToken);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes token when within 30 seconds of expiry', async () => {
    const expiringToken = createTestJwt(20); // 20s remaining (< 30s)
    const freshToken = createTestJwt(3600);

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: expiringToken }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: freshToken }),
      });
    global.fetch = mockFetch as unknown as typeof fetch;

    const cache = new TokenCache('http://auth-stub:4566', 'driver-1');

    const token1 = await cache.getToken();
    expect(token1).toBe(expiringToken);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Because expiringToken has only 20s left, the next call must refresh
    const token2 = await cache.getToken();
    expect(token2).toBe(freshToken);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws error when auth service returns non-200 status', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'DB connection failed',
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const cache = new TokenCache('http://auth-stub:4566', 'driver-1');
    await expect(cache.getToken()).rejects.toThrow('Auth service error');
  });
});
