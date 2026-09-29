/**
 * WebSocket $disconnect route handler for Notification Service.
 *
 * Framework-free core logic: looks up connection record and removes both forward
 * and reverse lookup items from DynamoDB.
 */

import { DynamoAccessor } from '@ride-dispatch/dynamo-client';

export interface DisconnectResult {
  statusCode: number;
}

export async function handleDisconnect(
  connectionId: string,
  deps: DynamoAccessor,
): Promise<DisconnectResult> {
  const forwardRecord = await deps.getItem(`CONNECTION#${connectionId}`, 'DETAILS');

  if (!forwardRecord) {
    // If no prior connection record exists (e.g. unauthenticated connection rejected at $connect),
    // cleanly succeed with 200 — nothing to clean up.
    return { statusCode: 200 };
  }

  const subjectId = forwardRecord.subjectId as string;

  // Clean up both forward- and reverse-lookup items
  await deps.deleteItem(`CONNECTION#${connectionId}`, 'DETAILS');

  if (subjectId) {
    await deps.deleteItem(`USER#${subjectId}`, `CONNECTION#${connectionId}`);
  }

  return { statusCode: 200 };
}
