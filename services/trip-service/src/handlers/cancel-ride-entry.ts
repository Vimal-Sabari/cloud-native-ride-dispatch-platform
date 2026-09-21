/**
 * Lambda adapter entrypoint for POST /rides/{id}/cancel (Cancel Ride).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { cancelRide } from "./cancel-ride";

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

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const rideId = event.pathParameters?.id || event.pathParameters?.rideId || "";
    if (!rideId) {
      return jsonResponse(400, { error: "Missing rideId in path parameters" });
    }

    const result = await cancelRide(rideId, dynamoClient);
    return jsonResponse(result.statusCode, result.body);
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      (("name" in error && (error as { name: string }).name === "ConditionalCheckFailedException") ||
        ("__type" in error && (error as { __type: string }).__type.endsWith("ConditionalCheckFailedException")))
    ) {
      return jsonResponse(409, { message: "Ride is no longer cancellable" });
    }
    console.error("cancel-ride failed", { error, event });
    return jsonResponse(500, { message: "Internal server error" });
  }
};
