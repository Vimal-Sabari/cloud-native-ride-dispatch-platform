/**
 * Architectural note on JWT logic split:
 *
 * verifyToken and its associated types/errors reside here in the shared `@ride-dispatch/auth`
 * package because multiple services require token verification:
 *   1. Auth Stub's API Gateway Lambda Authorizer (Module 8)
 *   2. Notification Service's WebSocket $connect handler (Module 20)
 *
 * In contrast, token issuance (`signToken`) remains in `services/auth-stub`, as only the auth stub
 * acts as an issuing authority in this platform architecture.
 */

import jwt, { JwtPayload } from 'jsonwebtoken';

export type UserRole = 'driver' | 'rider';

export interface DecodedToken {
  sub: string;
  role: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Retrieves the JWT signing secret from the environment.
 * Throws a clear error if missing, preventing silent insecure fallbacks.
 */
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error('JWT_SECRET environment variable is missing');
  }
  return secret;
}

/**
 * Verifies a JWT and extracts claims.
 * Throws an AuthError for expired, malformed, or invalid signatures.
 */
export function verifyToken(token: string): DecodedToken {
  const secret = getSecret();
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    if (!decoded.sub || typeof decoded.sub !== 'string') {
      throw new AuthError('Token payload missing valid sub claim');
    }
    if (!decoded.role || typeof decoded.role !== 'string') {
      throw new AuthError('Token payload missing valid role claim');
    }

    return {
      sub: decoded.sub,
      role: decoded.role,
    };
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      throw err;
    }
    if (err instanceof Error) {
      throw new AuthError(`Token verification failed: ${err.message}`);
    }
    throw new AuthError('Token verification failed with unknown error');
  }
}
