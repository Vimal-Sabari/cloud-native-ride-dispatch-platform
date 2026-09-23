/**
 * Lambda adapter entrypoint for POST /riders/{id}/rides (Request Ride).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { RequestRideBody } from "@ride-dispatch/models";
import { requestRide } from "./request-ride";

function getTableName(): string {
  return (
    process.env.RIDES_TABLE ||
    process.env.DYNAMO_TABLE_NAME ||
    process.env.TABLE_NAME ||
    "ride-dispatch-platform-local"
  );
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

    let rawBody = event.body || "{}";
    if (event.isBase64Encoded && event.body) {
      try {
        rawBody = Buffer.from(event.body, "base64").toString("utf-8");
      } catch {
        return jsonResponse(400, { error: "Invalid base64 request body" });
      }
    }

    let body: RequestRideBody;
    try {
      body = JSON.parse(rawBody) as RequestRideBody;
    } catch {
      return jsonResponse(400, { error: "Invalid JSON in request body" });
    }

    const result = await requestRide(riderId, body, dynamoClient);
    return jsonResponse(result.statusCode, result.body);
  } catch (error) {
    console.error("request-ride failed", { error, event });
    return jsonResponse(500, { message: "Internal server error" });
  }
};
