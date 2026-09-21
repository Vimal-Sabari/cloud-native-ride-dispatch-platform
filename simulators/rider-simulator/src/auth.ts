/**
 * Authentication helper and JWT token caching for simulated riders.
 *
 * ARCHITECTURAL NOTE:
 * This module duplicates the lightweight `TokenCache` implementation from the Driver Simulator
 * (`simulators/driver-simulator/src/auth.ts`) configured for `role: "rider"`.
 * This duplication is intentional to ensure total independence between the rider and driver
 * simulator packages without introducing cross-simulator couplings or overhead.
 */

interface TokenResponse {
  token: string;
}

interface JwtPayload {
  exp?: number;
  sub?: string;
  role?: string;
}

/**
 * Decodes the expiration time (`exp` in unix seconds) from a standard JWT
 * by base64-decoding the payload section without requiring signature verification.
 */
export function decodeJwtExpiry(token: string): number {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT token structure: expected at least two dot-separated segments');
  }

  try {
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = Buffer.from(payloadBase64, 'base64').toString('utf-8');
    const payload = JSON.parse(jsonStr) as JwtPayload;

    if (typeof payload.exp !== 'number') {
      throw new Error("JWT payload does not contain a numeric 'exp' claim");
    }

    return payload.exp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to decode JWT expiry claim: ${msg}`);
  }
}

export class TokenCache {
  private readonly authBaseUrl: string;
  private readonly subjectId: string;
  private cachedToken: string | null = null;
  private expiresAtSec: number = 0;
  private refreshPromise: Promise<string> | null = null;

  constructor(authBaseUrl: string, subjectId: string) {
    this.authBaseUrl = authBaseUrl.replace(/\/+$/, '');
    this.subjectId = subjectId;
  }

  /**
   * Returns a valid JWT token for this rider, fetching or refreshing as needed.
   * Re-fetches when within 30 seconds of expiry.
   */
  async getToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);

    if (this.cachedToken && this.expiresAtSec - nowSec > 30) {
      return this.cachedToken;
    }

    // Deduplicate concurrent refresh calls for this rider
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.fetchToken().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async fetchToken(): Promise<string> {
    const url = `${this.authBaseUrl}/auth/token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subjectId: this.subjectId,
        role: 'rider',
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(
        `Auth service error (${res.status} ${res.statusText}) when requesting token for ${this.subjectId}: ${errorText}`,
      );
    }

    const data = (await res.json()) as TokenResponse;
    if (!data.token || typeof data.token !== 'string') {
      throw new Error(
        `Auth service response for ${this.subjectId} missing valid string 'token' property`,
      );
    }

    this.cachedToken = data.token;
    this.expiresAtSec = decodeJwtExpiry(data.token);

    return this.cachedToken;
  }
}
