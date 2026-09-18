import jwt, { JwtPayload } from "jsonwebtoken";

export type UserRole = "driver" | "rider";

export interface DecodedToken {
  sub: string;
  role: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Retrieves the JWT signing secret from the environment.
 * Throws a clear error if missing, preventing silent insecure fallbacks.
 */
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error("JWT_SECRET environment variable is missing");
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
    algorithm: "HS256",
    expiresIn: "12h",
  });
}

/**
 * Verifies a JWT and extracts claims.
 * Throws an AuthError for expired, malformed, or invalid signatures.
 */
export function verifyToken(token: string): DecodedToken {
  const secret = getSecret();
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
    }) as JwtPayload;

    if (!decoded.sub || typeof decoded.sub !== "string") {
      throw new AuthError("Token payload missing valid sub claim");
    }
    if (!decoded.role || typeof decoded.role !== "string") {
      throw new AuthError("Token payload missing valid role claim");
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
    throw new AuthError("Token verification failed with unknown error");
  }
}
