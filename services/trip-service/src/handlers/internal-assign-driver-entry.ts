/**
 * Lambda adapter entrypoint for POST /internal/rides/{id}/assign-driver (Internal Assign Driver).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient, isConditionalCheckFailed } from "@ride-dispatch/dynamo-client";
import { assignDriver } from "./internal-assign-driver";

function getTableName(): string {
  const table = process.env.RIDES_TABLE || process.env.DYNAMO_TABLE_NAME || process.env.TABLE_NAME;
  if (!table) {
    if (process.env.NODE_ENV === "test") {
      return "ride-dispatch-platform-local";
    }
    throw new Error("RIDES_TABLE is not configured");
  }
  return table;
}

function getEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) {
    return process.env.AWS_ENDPOINT_URL;
  }
  if (process.env.LOCALSTACK_HOSTNAME) {
    return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
  }
  return process.env.DYNAMO_ENDPOINT || undefined;
}

const dynamoClient = new DynamoClient(getTableName(), getEndpoint());

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
  const rideId = event.pathParameters?.id || event.pathParameters?.rideId || "";
  let driverId = "";
  try {
    // 1. Enforce internal service-to-service authentication before any business logic
    const apiKey = getHeaderCaseInsensitive(event.headers, "x-internal-api-key");
    const expectedKey = process.env.INTERNAL_API_KEY;

    if (!expectedKey || !apiKey || apiKey !== expectedKey) {
      return jsonResponse(401, {
        error: "Unauthorized: invalid or missing internal API key",
      });
    }

    if (!rideId) {
      return jsonResponse(400, { error: "Missing rideId in path parameters" });
    }

    let rawBody = event.body || "{}";
    if (event.isBase64Encoded && event.body) {
      try {
        rawBody = Buffer.from(event.body, "base64").toString("utf-8");
      } catch {
        return jsonResponse(400, { error: "Invalid base64 request body" });
      }
    }

    let body: AssignDriverRequestBody;
    try {
      body = JSON.parse(rawBody) as AssignDriverRequestBody;
    } catch {
      return jsonResponse(400, { error: "Invalid JSON in request body" });
    }

    driverId = body.driverId || "";
    if (!driverId) {
      return jsonResponse(400, { error: "Missing driverId in request body" });
    }

    const result = await assignDriver(rideId, driverId, dynamoClient, event.headers || {});
    return jsonResponse(result.statusCode, result.body);
  } catch (error: unknown) {
    if (isConditionalCheckFailed(error)) {
      return jsonResponse(409, {
        message: "Ride is no longer available for assignment",
      });
    }
    console.error("DynamoDB ride mutation failed", {
      operation: "assign-driver",
      rideId,
      driverId,
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { message: "Internal server error" });
  }
};
