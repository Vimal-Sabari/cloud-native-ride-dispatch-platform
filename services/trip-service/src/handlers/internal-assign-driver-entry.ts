/**
 * Lambda adapter entrypoint for POST /internal/rides/{id}/assign-driver (Internal Assign Driver).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { assignDriver } from "./internal-assign-driver";

const tableName = process.env.DYNAMO_TABLE_NAME || "ride-dispatch-platform-local";
const endpoint = process.env.DYNAMO_ENDPOINT || undefined;
const dynamoClient = new DynamoClient(tableName, endpoint);

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function getHeaderCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  target: string
): string | undefined {
  if (!headers) return undefined;
  const lower = target.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value?.trim();
    }
  }
  return undefined;
}

interface AssignDriverRequestBody {
  driverId?: string;
}

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  // 1. Enforce internal service-to-service authentication before any business logic
  const apiKey = getHeaderCaseInsensitive(event.headers, "x-internal-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return jsonResponse(401, {
      error: "Unauthorized: invalid or missing internal API key",
    });
  }

  const rideId = event.pathParameters?.id || "";

  let body: AssignDriverRequestBody;
  try {
    body = JSON.parse(event.body || "{}") as AssignDriverRequestBody;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON in request body" });
  }

  const driverId = body.driverId || "";

  const result = await assignDriver(rideId, driverId, dynamoClient, event.headers || {});
  return jsonResponse(result.statusCode, result.body);
};
