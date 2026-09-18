import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { signToken, UserRole } from "./jwt-utils";

interface TokenRequestBody {
  subjectId?: unknown;
  role?: unknown;
}

/**
 * Lambda handler for POST /auth/token endpoint.
 * Issues a signed JWT stub token for development and testing.
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing request body" }),
    };
  }

  let body: TokenRequestBody;
  try {
    body = JSON.parse(event.body) as TokenRequestBody;
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON in request body" }),
    };
  }

  const { subjectId, role } = body;

  if (!subjectId || typeof subjectId !== "string" || subjectId.trim() === "") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Invalid or missing subjectId: must be a non-empty string",
      }),
    };
  }

  if (role !== "driver" && role !== "rider") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Invalid or missing role: must be either 'driver' or 'rider'",
      }),
    };
  }

  try {
    const token = signToken(subjectId.trim(), role as UserRole);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: message }),
    };
  }
}
