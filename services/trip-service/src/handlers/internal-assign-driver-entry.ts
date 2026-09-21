/**
 * Lambda adapter entrypoint for POST /internal/rides/{id}/assign-driver (Internal Assign Driver).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { assignDriver } from "./internal-assign-driver";

function getTableName(): string {
  return process.env.DYNAMO_TABLE_NAME || process.env.RIDES_TABLE || "ride-dispatch-platform-local";
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
  try {
    // 1. Enforce internal service-to-service authentication before any business logic
    const apiKey = getHeaderCaseInsensitive(event.headers, "x-internal-api-key");
    const expectedKey = process.env.INTERNAL_API_KEY;

    if (!expectedKey || !apiKey || apiKey !== expectedKey) {
      return jsonResponse(401, {
        error: "Unauthorized: invalid or missing internal API key",
      });
    }

    const rideId = event.pathParameters?.id || event.pathParameters?.rideId || "";
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

    const driverId = body.driverId || "";
    if (!driverId) {
      return jsonResponse(400, { error: "Missing driverId in request body" });
    }

    const result = await assignDriver(rideId, driverId, dynamoClient, event.headers || {});
    return jsonResponse(result.statusCode, result.body);
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      (("name" in error && (error as { name: string }).name === "ConditionalCheckFailedException") ||
        ("__type" in error && (error as { __type: string }).__type.endsWith("ConditionalCheckFailedException")))
    ) {
      return jsonResponse(409, { message: "Ride is no longer assignable" });
    }
    console.error("assign-driver failed", { error, event });
    return jsonResponse(500, { message: "Internal server error" });
  }
};
