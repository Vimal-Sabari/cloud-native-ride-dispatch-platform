/**
 * WebSocket $connect route handler for Notification Service.
 *
 * Framework-free core logic: validates caller JWT and persists both forward and
 * reverse connection lookup items in DynamoDB.
 */

import { verifyToken } from '@ride-dispatch/auth';
import { DynamoAccessor } from '@ride-dispatch/dynamo-client';

export interface ConnectResult {
  statusCode: number;
}

export { handler, WebSocketEvent, WebSocketResult } from './connect-entry';

export async function handleConnect(
  connectionId: string,
  token: string | undefined,
  deps: DynamoAccessor,
): Promise<ConnectResult> {
  if (!token || token.trim() === '') {
    return { statusCode: 401 };
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return { statusCode: 401 };
  }

  const now = new Date().toISOString();

  // (a) Forward-lookup item: maps connectionId -> user details
  await deps.putItem({
    PK: `CONNECTION#${connectionId}`,
    SK: 'DETAILS',
    subjectId: decoded.sub,
    role: decoded.role,
    connectedAt: now,
  });

  // (b) Reverse-lookup item: maps userId -> connectionId (for fanout queries in Module 21)
  await deps.putItem({
    PK: `USER#${decoded.sub}`,
    SK: `CONNECTION#${connectionId}`,
    connectedAt: now,
  });

  return { statusCode: 200 };
}
