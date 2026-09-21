/**
 * Lambda adapter entrypoint for GET /rides/{id} (Get Ride Details).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { getRide } from "./get-ride";

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

    const result = await getRide(rideId, dynamoClient);
    return jsonResponse(result.statusCode, result.body);
  } catch (error) {
    console.error("get-ride failed", { error, event });
    return jsonResponse(500, { message: "Internal server error" });
  }
};
