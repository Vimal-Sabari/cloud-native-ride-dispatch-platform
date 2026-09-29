import jwt from 'jsonwebtoken';
import { verifyToken, AuthError } from '../src/jwt-utils';

describe('shared jwt-utils', () => {
  const originalEnv = process.env;
  const testSecret = 'test-jwt-secret-key-12345';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, JWT_SECRET: testSecret };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('verifyToken decodes valid driver token', () => {
    const token = jwt.sign({ sub: 'user-driver-1', role: 'driver' }, testSecret, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('user-driver-1');
    expect(decoded.role).toBe('driver');
  });

  test('verifyToken decodes valid rider token', () => {
    const token = jwt.sign({ sub: 'user-rider-42', role: 'rider' }, testSecret, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('user-rider-42');
    expect(decoded.role).toBe('rider');
  });

  test('throws error if JWT_SECRET environment variable is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() => verifyToken('some.token.here')).toThrow(
      'JWT_SECRET environment variable is missing',
    );
  });

  test('verifying an expired token throws AuthError', () => {
    const expiredToken = jwt.sign({ sub: 'expired-user', role: 'rider' }, testSecret, {
      expiresIn: '-1h',
    });
    expect(() => verifyToken(expiredToken)).toThrow(AuthError);
    expect(() => verifyToken(expiredToken)).toThrow(/expired/i);
  });

  test('verifying a token signed with a different secret throws AuthError', () => {
    const wrongSecret = 'completely-different-secret-54321';
    const foreignToken = jwt.sign({ sub: 'spoofed-user', role: 'driver' }, wrongSecret, {
      expiresIn: '1h',
    });
    expect(() => verifyToken(foreignToken)).toThrow(AuthError);
    expect(() => verifyToken(foreignToken)).toThrow(/signature/i);
  });

  test('verifying a malformed token throws AuthError', () => {
    expect(() => verifyToken('not-a-valid-jwt')).toThrow(AuthError);
  });
});
