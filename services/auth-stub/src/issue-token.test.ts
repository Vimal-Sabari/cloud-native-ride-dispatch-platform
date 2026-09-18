import { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "./issue-token";

describe("issue-token handler", () => {
  const originalEnv = process.env;
  const testSecret = "test-jwt-secret-key-12345";

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: testSecret };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createProxyEvent(body: string | null): APIGatewayProxyEvent {
    return {
      body,
      headers: { "Content-Type": "application/json" },
      multiValueHeaders: {},
      httpMethod: "POST",
      isBase64Encoded: false,
      path: "/auth/token",
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as unknown as APIGatewayProxyEvent["requestContext"],
      resource: "/auth/token",
    };
  }

  test("valid request for driver returns 200 with three-part dot-separated JWT", async () => {
    const event = createProxyEvent(
      JSON.stringify({ subjectId: "driver-123", role: "driver" })
    );

    const result = await handler(event);
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body).toHaveProperty("token");
    expect(typeof body.token).toBe("string");

    // Standard JWT has 3 dot-separated base64 segments: header.payload.signature
    const segments = body.token.split(".");
    expect(segments.length).toBe(3);
    expect(segments[0].length).toBeGreaterThan(0);
    expect(segments[1].length).toBeGreaterThan(0);
    expect(segments[2].length).toBeGreaterThan(0);
  });

  test("valid request for rider returns 200 with valid JWT", async () => {
    const event = createProxyEvent(
      JSON.stringify({ subjectId: "rider-456", role: "rider" })
    );

    const result = await handler(event);
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body).toHaveProperty("token");
    const segments = body.token.split(".");
    expect(segments.length).toBe(3);
  });

  test("missing subjectId returns 400 Bad Request", async () => {
    const event = createProxyEvent(JSON.stringify({ role: "driver" }));

    const result = await handler(event);
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/subjectId/i);
  });

  test("empty subjectId string returns 400 Bad Request", async () => {
    const event = createProxyEvent(
      JSON.stringify({ subjectId: "   ", role: "driver" })
    );

    const result = await handler(event);
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/subjectId/i);
  });

  test("invalid role returns 400 Bad Request", async () => {
    const event = createProxyEvent(
      JSON.stringify({ subjectId: "admin-1", role: "admin" })
    );

    const result = await handler(event);
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/role/i);
  });

  test("missing body returns 400 Bad Request", async () => {
    const event = createProxyEvent(null);

    const result = await handler(event);
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/body/i);
  });

  test("invalid JSON body returns 400 Bad Request", async () => {
    const event = createProxyEvent("{ not-valid-json");

    const result = await handler(event);
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/json/i);
  });
});
