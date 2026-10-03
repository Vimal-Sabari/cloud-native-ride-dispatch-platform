/**
 * SNS Fan-Out Handler for Notification Service.
 *
 * Subscribes to match-events SNS topic, queries active WebSocket connection records
 * for the affected rider and driver, and concurrently pushes real-time event notifications.
 * Prunes stale connections upon receiving GoneException (410).
 */

import { DynamoAccessor } from '@ride-dispatch/dynamo-client';
import { ConnectionManager } from '../connection-manager';

export { ConnectionManager };

export interface FanoutMessage {
  eventType: string;
  rideId: string;
  riderId: string;
  driverId?: string;
  [key: string]: unknown;
}

const SUPPORTED_EVENT_TYPES = new Set(['ride-matched', 'ride-cancelled']);

export async function handleFanoutEvent(
  message: FanoutMessage,
  deps: DynamoAccessor & { connectionManager: ConnectionManager },
): Promise<void> {
  // 1. Guard against unrecognized event types (schema evolution resilience)
  if (!message || !message.eventType || !SUPPORTED_EVENT_TYPES.has(message.eventType)) {
    console.log(`Unrecognized or unsupported eventType '${message?.eventType}', skipping fanout without error`);
    return;
  }

  // 2. Identify target subject IDs: always riderId, and driverId if present
  const targetSubjects = new Set<string>();
  if (message.riderId && message.riderId.trim() !== '') {
    targetSubjects.add(message.riderId.trim());
  }
  if (message.driverId && message.driverId.trim() !== '') {
    targetSubjects.add(message.driverId.trim());
  }

  if (targetSubjects.size === 0) {
    return;
  }

  // 3. Query active connection records for each target subject from the main table
  const activeConnections: Array<{ subjectId: string; connectionId: string }> = [];

  for (const subjectId of targetSubjects) {
    const queryResult = await deps.query?.({
      keyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      expressionAttributeValues: {
        ':pk': `USER#${subjectId}`,
        ':skPrefix': 'CONNECTION#',
      },
    });

    const items = Array.isArray(queryResult)
      ? queryResult
      : ((queryResult as unknown as { items?: Record<string, unknown>[] })?.items ?? []);

    if (items.length > 0) {
      for (const item of items) {
        const sk = item.SK as string | undefined;
        if (sk && sk.startsWith('CONNECTION#')) {
          const connectionId = sk.substring('CONNECTION#'.length);
          if (connectionId) {
            activeConnections.push({ subjectId, connectionId });
          }
        }
      }
    }
  }

  if (activeConnections.length === 0) {
    return;
  }

  // 4. Concurrently push event payload to all active connections
  await Promise.all(
    activeConnections.map(async ({ subjectId, connectionId }) => {
      const result = await deps.connectionManager.postToConnection(connectionId, message);

      // 5. Clean up both forward and reverse lookup records if connection is stale (GoneException / 410)
      if (result && result.stale) {
        await Promise.all([
          deps.deleteItem(`CONNECTION#${connectionId}`, 'DETAILS'),
          deps.deleteItem(`USER#${subjectId}`, `CONNECTION#${connectionId}`),
        ]);
      }
    }),
  );
}
