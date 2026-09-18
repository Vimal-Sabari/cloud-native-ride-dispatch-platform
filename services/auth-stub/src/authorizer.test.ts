import jwt from "jsonwebtoken";
import { APIGatewayTokenAuthorizerEvent } from "aws-lambda";
import { handler } from "./authorizer";
import { signToken } from "./jwt-utils";

describe("authorizer handler", () => {
  const originalEnv = process.env;
  const testSecret = "test-jwt-secret-key-12345";
  const mockMethodArn =
    "arn:aws:execute-api:us-east-1:123456789012:api-id/dev/GET/rides";

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: testSecret };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createTokenEvent(
    authorizationToken: string
  ): APIGatewayTokenAuthorizerEvent {
    return {
      type: "TOKEN",
      methodArn: mockMethodArn,
      authorizationToken,
    };
  }

  test("valid Bearer token generates Allow IAM policy with string context", async () => {
    const token = signToken("driver-99", "driver");
    const event = createTokenEvent(`Bearer ${token}`);

    const policy = await handler(event);

    expect(policy.principalId).toBe("driver-99");
    expect(policy.policyDocument.Statement).toHaveLength(1);
    expect(policy.policyDocument.Statement[0]).toEqual({
      Action: "execute-api:Invoke",
      Effect: "Allow",
      Resource: mockMethodArn,
    });
    expect(policy.context).toEqual({
      sub: "driver-99",
      role: "driver",
    });
    expect(typeof policy.context?.sub).toBe("string");
    expect(typeof policy.context?.role).toBe("string");
  });

  test("valid raw token (without Bearer prefix) generates Allow IAM policy", async () => {
    const token = signToken("rider-101", "rider");
    const event = createTokenEvent(token);

    const policy = await handler(event);
    expect(policy.principalId).toBe("rider-101");
    expect(policy.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(policy.context).toEqual({
      sub: "rider-101",
      role: "rider",
    });
  });

  test("missing authorizationToken throws Unauthorized", async () => {
    const event = createTokenEvent("");
    await expect(handler(event)).rejects.toThrow("Unauthorized");
  });

  test("malformed token throws Unauthorized", async () => {
    const event = createTokenEvent("Bearer invalid.token.payload");
    await expect(handler(event)).rejects.toThrow("Unauthorized");
  });

  test("expired token throws Unauthorized", async () => {
    const expiredToken = jwt.sign(
      { sub: "user-old", role: "driver" },
      testSecret,
      { expiresIn: "-10m" }
    );
    const event = createTokenEvent(`Bearer ${expiredToken}`);

    await expect(handler(event)).rejects.toThrow("Unauthorized");
  });

  test("token signed with wrong secret throws Unauthorized", async () => {
    const wrongToken = jwt.sign(
      { sub: "hacker", role: "driver" },
      "wrong-secret",
      { expiresIn: "1h" }
    );
    const event = createTokenEvent(`Bearer ${wrongToken}`);

    await expect(handler(event)).rejects.toThrow("Unauthorized");
  });
});
