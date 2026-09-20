/**
 * Lambda adapter entrypoint for GET /riders/{id}/rides (List Rider Rides).
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoClient } from "@ride-dispatch/dynamo-client";
import { listRiderRides } from "./list-rider-rides";

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

  const result = await listRiderRides(riderId, dynamoClient);
  return jsonResponse(result.statusCode, result.body);
};
