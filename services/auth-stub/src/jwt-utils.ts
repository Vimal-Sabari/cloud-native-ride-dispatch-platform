/**
 * Architectural note on JWT logic split:
 *
 * Token verification (`verifyToken`) and associated error/claim types have been refactored
 * into the shared package `@ride-dispatch/auth`, as multiple consuming microservices
 * (the API Gateway Lambda Authorizer in auth-stub, and the Notification Service WebSocket
 * $connect handler in Module 20) require token validation.
 *
 * Token issuance (`signToken`) remains here in `services/auth-stub`, because this service
 * acts as the sole token-issuing authority in the platform architecture.
 */

import jwt from 'jsonwebtoken';
import { UserRole, DecodedToken, AuthError, verifyToken } from '@ride-dispatch/auth';

export { UserRole, DecodedToken, AuthError, verifyToken };

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
 * Signs a JWT with HS256 algorithm and 12-hour expiry.
 * Payload includes subject identifier and user role.
 */
export function signToken(subjectId: string, role: UserRole): string {
  const secret = getSecret();
  return jwt.sign({ sub: subjectId, role }, secret, {
    algorithm: 'HS256',
    expiresIn: '12h',
  });
}
