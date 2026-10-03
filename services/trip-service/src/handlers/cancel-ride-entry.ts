/**
 * Lambda adapter entrypoint for POST /rides/{id}/cancel (Cancel Ride).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient, isConditionalCheckFailed } from "@ride-dispatch/dynamo-client";
import { SnsClient } from "@ride-dispatch/sns-client";
import { cancelRide } from "./cancel-ride";

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

function getSnsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) {
    return process.env.AWS_ENDPOINT_URL;
  }
  if (process.env.LOCALSTACK_HOSTNAME) {
    return `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
  }
  return process.env.SNS_ENDPOINT || undefined;
}

const dynamoClient = new DynamoClient(getTableName(), getEndpoint());
const snsClient = new SnsClient(getSnsEndpoint());
const matchEventsTopicArn = process.env.MATCH_EVENTS_TOPIC_ARN || "";

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
  const rideId = event.pathParameters?.id || event.pathParameters?.rideId || "";
  try {
    if (!rideId) {
      return jsonResponse(400, { error: "Missing rideId in path parameters" });
    }

    const result = await cancelRide(rideId, dynamoClient, snsClient, matchEventsTopicArn);
    return jsonResponse(result.statusCode, result.body);
  } catch (error: unknown) {
    if (isConditionalCheckFailed(error)) {
      return jsonResponse(409, {
        message: "Ride cannot be cancelled in its current state",
      });
    }
    console.error("DynamoDB ride mutation failed", {
      operation: "cancel-ride",
      rideId,
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { message: "Internal server error" });
  }
};
