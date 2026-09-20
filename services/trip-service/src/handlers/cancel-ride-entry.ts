/**
 * Lambda adapter entrypoint for POST /rides/{id}/cancel (Cancel Ride).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { cancelRide } from "./cancel-ride";

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
  const rideId = event.pathParameters?.id || "";
  const result = await cancelRide(rideId, dynamoClient);
  return jsonResponse(result.statusCode, result.body);
};
