/**
 * Lambda adapter entrypoint for GET /riders/{id}/rides (List Rider Rides).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { listRiderRides } from "./list-rider-rides";

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
    const riderId =
      event.pathParameters?.id ||
      event.pathParameters?.riderId ||
      (event.requestContext?.authorizer?.sub as string) ||
      (event.requestContext?.authorizer?.principalId as string) ||
      (event.requestContext?.authorizer?.claims?.sub as string) ||
      "";

    if (!riderId) {
      return jsonResponse(400, { error: "Missing riderId in request" });
    }

    const result = await listRiderRides(riderId, dynamoClient);
    return jsonResponse(result.statusCode, result.body);
  } catch (error) {
    console.error("list-rider-rides failed", { error, event });
    return jsonResponse(500, { message: "Internal server error" });
  }
};
