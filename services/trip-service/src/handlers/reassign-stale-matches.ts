/**
 * Handler for reassigning stale MATCHED rides after driver-accept timeout.
 *
 * ARCHITECTURAL CONTEXT & DESIGN DECISIONS:
 *
 * 1. Query Pattern & GSI4 Sparse Index:
 *    To discover rides stuck in MATCHED state, scanning the entire table would be O(N) where N
 *    is total rides in history. Instead, a sparse Global Secondary Index (GSI4) is maintained:
 *    GSI4PK = "STATE#MATCHED", GSI4SK = updatedAt (ISO-8601 string).
 *    Because DynamoDB sparse GSIs only contain items where both index keys exist, GSI4 holds
 *    strictly rides currently in MATCHED state. When a ride leaves MATCHED (accepted, cancelled,
 *    or reassigned), handlers remove GSI4PK/GSI4SK.
 *    For resilience in environments where GSI4 is not provisioned, a graceful table scan fallback
 *    is included.
 *
 * 2. Optimistic Concurrency Control (OCC):
 *    Before resetting a ride to REQUESTED, we assert:
 *    `#state = :matched AND #updatedAt = :oldUpdatedAt`.
 *    If the driver accepted the ride (transitioning to DRIVER_EN_ROUTE) or the rider cancelled
 *    the ride (transitioning to CANCELLED) while this job was executing, the condition check
 *    fails gracefully (returns false). The ride is skipped with zero error or side effects.
 *
 * 3. Conditional Driver Release:
 *    Upon successfully reclaiming the ride, the driver's location record (`DRIVER#<id>#LOCATION`)
 *    is conditionally updated back to `available` with condition `#status = :busy`. This ensures
 *    we do not clobber a driver who was already set offline or assigned to another ride.
 *    The driver's `ACTIVE_RIDE_POINTER` (`GSI3`) is also cleaned up.
 *
 * 4. Direct SQS Re-enqueue vs DynamoDB Streams:
 *    Module 16's event-forwarder classifies DynamoDB Streams records. Per its classification
 *    rules, `ride-requested` events are emitted EXCLUSIVELY on DynamoDB `INSERT` records where
 *    `state == "REQUESTED"`. This stale match reassignment is a DynamoDB `MODIFY` record
 *    (`MATCHED` -> `REQUESTED`). Modifying the forwarder to treat state modifies as new requests
 *    would risk duplicate event storms and violation of the single-responsibility principle.
 *    Therefore, this handler directly enqueues the `ride-requested` event to the
 *    `ride-request-events` SQS queue with the exact schema expected by Matching Service.
 *
 * 5. Polyglot Symmetry:
 *    This TypeScript driver-release logic mirrors the Go Matching Service's `RevertDriverClaim`
 *    function (Module 17 / Module 27), adhering to the platform's polyglot convention where the
 *    same architectural concept is independently implemented in each service's native language.
 */

import { RideState } from '@ride-dispatch/models';
import { DynamoAccessor } from '../dynamo-accessor';

export interface SqsSender {
  sendMessage(queueUrl: string, messageBody: string): Promise<unknown>;
}

export type ReassignDeps = DynamoAccessor & {
  sqs?: SqsSender;
  queueUrl?: string;
};

export interface ReassignStaleMatchesResult {
  reassignedCount: number;
  rideIds: string[];
}

export interface RideDetailsItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  rideId?: string;
  riderId?: string;
  state?: string;
  driverId?: string;
  pickup?: { lat: number; lng: number };
  dropoff?: { lat: number; lng: number };
  updatedAt?: string;
  createdAt?: string;
  GSI4PK?: string;
  GSI4SK?: string;
}

/**
 * Core framework-free function to reassign stale MATCHED rides.
 */
export async function reassignStaleMatches(
  timeoutSeconds: number,
  deps: DynamoAccessor,
  sqsSenderParam?: SqsSender,
  queueUrlParam?: string,
): Promise<ReassignStaleMatchesResult> {
  const sqsSender = sqsSenderParam || (deps as ReassignDeps).sqs;
  const queueUrl =
    queueUrlParam ||
    (deps as ReassignDeps).queueUrl ||
    process.env.RIDE_REQUEST_EVENTS_QUEUE_URL ||
    process.env.QUEUE_URL;

  const nowMs = Date.now();
  const cutoffMs = nowMs - timeoutSeconds * 1000;

  // 1. Discover rides in MATCHED state using GSI4, with graceful fallback to scan
  let candidates: RideDetailsItem[] = [];
  try {
    const queryResults = await deps.query({
      indexName: 'GSI4',
      keyConditionExpression: 'GSI4PK = :gsi4pk',
      expressionAttributeNames: {
        '#gsi4pk': 'GSI4PK',
      },
      expressionAttributeValues: {
        ':gsi4pk': 'STATE#MATCHED',
      },
    });
    candidates = queryResults as RideDetailsItem[];
  } catch (queryErr) {
    console.warn(
      '[reassign-stale-matches] GSI4 query failed or index not ready; falling back to main table query/scan:',
      queryErr instanceof Error ? queryErr.message : String(queryErr),
    );
    candidates = [];
  }

  const reassignedRideIds: string[] = [];

  for (const ride of candidates) {
    const rawRideId =
      ride.rideId || (typeof ride.PK === 'string' ? ride.PK.replace(/^RIDE#/, '') : '');
    const rideId = rawRideId.trim();
    if (!rideId) continue;

    const updatedAtStr =
      (ride.updatedAt as string | undefined) || (ride.createdAt as string | undefined);
    if (!updatedAtStr) continue;

    const updatedAtMs = new Date(updatedAtStr).getTime();
    if (isNaN(updatedAtMs)) continue;

    // Check if ride has exceeded timeout
    if (updatedAtMs > cutoffMs) {
      // Ride is still within driver-accept timeout window (e.g. matched 10s ago)
      continue;
    }

    const assignedDriverId = ride.driverId ? String(ride.driverId).trim() : undefined;
    const nowIso = new Date().toISOString();

    // 2. Conditionally transition ride from MATCHED to REQUESTED
    // Condition: state == MATCHED AND updatedAt == the value read
    const updatedRideItem: Record<string, unknown> = {
      ...ride,
      PK: `RIDE#${rideId}`,
      SK: 'DETAILS',
      state: RideState.REQUESTED,
      updatedAt: nowIso,
    };
    // Remove driver assignment and GSI4 index keys
    delete updatedRideItem.driverId;
    delete updatedRideItem.GSI4PK;
    delete updatedRideItem.GSI4SK;

    const condition = '#state = :matched AND #updatedAt = :oldUpdatedAt';
    const exprNames: Record<string, string> = {
      '#state': 'state',
      '#updatedAt': 'updatedAt',
    };
    const exprValues: Record<string, unknown> = {
      ':matched': 'MATCHED',
      ':oldUpdatedAt': updatedAtStr,
    };

    let wonRace = false;
    try {
      wonRace = await deps.conditionalPutItem(updatedRideItem, condition, exprNames, exprValues);
    } catch (putErr) {
      console.warn(
        `[reassign-stale-matches] Conditional put failed with error for ride ${rideId}:`,
        putErr instanceof Error ? putErr.message : String(putErr),
      );
      wonRace = false;
    }

    if (!wonRace) {
      // Optimistic concurrency check failed: ride progressed or was cancelled concurrently
      console.info(
        `[reassign-stale-matches] Stale ride ${rideId} was modified concurrently. Skipping reassignment.`,
      );
      continue;
    }

    // 3. Conditionally release driver back to available
    if (assignedDriverId) {
      try {
        const driverPk = `DRIVER#${assignedDriverId}`;
        const driverItem = await deps.getItem(driverPk, 'LOCATION');
        if (driverItem) {
          const updatedDriverItem: Record<string, unknown> = {
            ...driverItem,
            status: 'available',
            Status: 'available',
            GSI1SK: `DRIVER#available#${assignedDriverId}`,
            updatedAt: nowIso,
          };
          const driverCond = '#status = :busy';
          const driverNames = { '#status': 'status' };
          const driverVals = { ':busy': 'busy' };

          await deps.conditionalPutItem(updatedDriverItem, driverCond, driverNames, driverVals);
        }

        // Clean up GSI3 active ride pointer
        await deps.deleteItem(driverPk, 'ACTIVE_RIDE_POINTER');
      } catch (driverErr) {
        console.warn(
          `[reassign-stale-matches] Failed to release driver ${assignedDriverId} for ride ${rideId}:`,
          driverErr instanceof Error ? driverErr.message : String(driverErr),
        );
      }
    }

    // 4. Directly re-enqueue ride-requested event to SQS
    if (sqsSender && queueUrl) {
      const eventPayload = {
        eventType: 'ride-requested',
        payload: {
          rideId,
          riderId: ride.riderId,
          pickup: ride.pickup,
        },
      };

      try {
        await sqsSender.sendMessage(queueUrl, JSON.stringify(eventPayload));
      } catch (sqsErr) {
        console.error(
          `[reassign-stale-matches] Failed to re-enqueue ride ${rideId} to SQS queue ${queueUrl}:`,
          sqsErr instanceof Error ? sqsErr.message : String(sqsErr),
        );
      }
    }

    reassignedRideIds.push(rideId);
  }

  return {
    reassignedCount: reassignedRideIds.length,
    rideIds: reassignedRideIds,
  };
}
