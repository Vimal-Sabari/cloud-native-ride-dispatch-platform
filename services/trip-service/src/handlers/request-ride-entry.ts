/**
 * Lambda adapter entrypoint for POST /riders/{id}/rides (Request Ride).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { RequestRideBody } from "@ride-dispatch/models";
import { requestRide } from "./request-ride";

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

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const riderId =
    event.pathParameters?.id ||
    (event.requestContext?.authorizer?.sub as string) ||
    (event.requestContext?.authorizer?.principalId as string) ||
    "";

  let body: RequestRideBody;
  try {
    body = JSON.parse(event.body || "{}") as RequestRideBody;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON in request body" });
  }

  const result = await requestRide(riderId, body, dynamoClient);
  return jsonResponse(result.statusCode, result.body);
};
