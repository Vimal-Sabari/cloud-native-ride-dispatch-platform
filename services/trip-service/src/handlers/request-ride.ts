/**
 * Handler for requesting a new ride.
 *
 * Implements full idempotency semantics:
 * 1. Checks for existing idempotency pointer `IDEMPOTENCY#<riderId>#<idempotencyKey>` / `RIDE_POINTER`.
 * 2. If present, replays the existing ride with HTTP 200.
 * 3. Creates the new ride item in state REQUESTED (`RIDE#<rideId>` / `DETAILS`).
 * 4. Indexes under GSI2 (`GSI2PK: RIDER#<riderId>`, `GSI2SK: RIDE#<createdAt>#<rideId>`).
 * 5. Uses a conditional put for the idempotency pointer to handle concurrent race conditions.
 */

import * as crypto from 'crypto';
import { RequestRideBody, RideState } from '@ride-dispatch/models';
import { createLogger, emitEMFMetric } from '@ride-dispatch/logging';
import { DynamoAccessor } from '../dynamo-accessor';

function isValidCoordinates(coords: unknown): coords is { lat: number; lng: number } {
  if (!coords || typeof coords !== 'object') return false;
  const { lat, lng } = coords as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export async function requestRide(
  riderId: string,
  body: RequestRideBody,
  deps: DynamoAccessor,
): Promise<{ statusCode: number; body: unknown }> {
  const baseLogger = createLogger('trip-service');
  // Before rideId is generated, scope logger with riderId (or 'anonymous' if missing)
  let logger = baseLogger.withCorrelationId(riderId || 'anonymous');

  if (!riderId || typeof riderId !== 'string' || riderId.trim() === '') {
    logger.warn('request ride failed: invalid or missing riderId');
    emitEMFMetric(
      'RideDispatch/TripService',
      { Route: 'request-ride' },
      { ErrorCount: { value: 1, unit: 'Count' } },
    );
    return {
      statusCode: 400,
      body: { error: 'Invalid or missing riderId' },
    };
  }

  if (!isValidCoordinates(body?.pickup)) {
    logger.warn('request ride failed: invalid pickup coordinates');
    emitEMFMetric(
      'RideDispatch/TripService',
      { Route: 'request-ride' },
      { ErrorCount: { value: 1, unit: 'Count' } },
    );
    return {
      statusCode: 400,
      body: {
        error: 'Invalid pickup coordinates: lat must be in [-90, 90], lng must be in [-180, 180]',
      },
    };
  }

  if (!isValidCoordinates(body?.dropoff)) {
    logger.warn('request ride failed: invalid dropoff coordinates');
    emitEMFMetric(
      'RideDispatch/TripService',
      { Route: 'request-ride' },
      { ErrorCount: { value: 1, unit: 'Count' } },
    );
    return {
      statusCode: 400,
      body: {
        error: 'Invalid dropoff coordinates: lat must be in [-90, 90], lng must be in [-180, 180]',
      },
    };
  }

  const idempotencyKey = body.idempotencyKey?.trim();

  // 1. Check if a ride already exists for this (riderId, idempotencyKey)
  if (idempotencyKey) {
    const pointerPk = `IDEMPOTENCY#${riderId}#${idempotencyKey}`;
    const existingPointer = await deps.getItem(pointerPk, 'RIDE_POINTER');

    if (existingPointer && typeof existingPointer.rideId === 'string') {
      const existingRide = await deps.getItem(`RIDE#${existingPointer.rideId}`, 'DETAILS');
      if (existingRide) {
        logger.info('idempotent replay: returning existing ride', {
          existingRideId: existingPointer.rideId,
        });
        emitEMFMetric(
          'RideDispatch/TripService',
          { Route: 'request-ride' },
          { RequestCount: { value: 1, unit: 'Count' } },
        );
        return {
          statusCode: 200,
          body: existingRide,
        };
      }
    }
  }

  // 2. Generate new ride item
  const rideId = crypto.randomUUID();
  // Now scope logger with the generated rideId for all subsequent operations
  logger = baseLogger.withCorrelationId(rideId);
  const now = new Date().toISOString();

  const rideItem: Record<string, unknown> = {
    PK: `RIDE#${rideId}`,
    SK: 'DETAILS',
    GSI2PK: `RIDER#${riderId}`,
    GSI2SK: `RIDE#${now}#${rideId}`,
    rideId,
    riderId,
    state: RideState.REQUESTED,
    pickup: { lat: body.pickup.lat, lng: body.pickup.lng },
    dropoff: { lat: body.dropoff.lat, lng: body.dropoff.lng },
    createdAt: now,
    updatedAt: now,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  // 3. Write main ride item
  await deps.putItem(rideItem);

  // 4. If idempotency key provided, write pointer with race-condition guard
  if (idempotencyKey) {
    const pointerItem: Record<string, unknown> = {
      PK: `IDEMPOTENCY#${riderId}#${idempotencyKey}`,
      SK: 'RIDE_POINTER',
      rideId,
      createdAt: now,
    };

    const wonRace = await deps.conditionalPutItem(pointerItem, 'attribute_not_exists(PK)');

    if (!wonRace) {
      // Another concurrent request with the same idempotency key won the write race;
      // return the winning ride rather than returning an error
      const winningPointer = await deps.getItem(
        `IDEMPOTENCY#${riderId}#${idempotencyKey}`,
        'RIDE_POINTER',
      );
      if (winningPointer && typeof winningPointer.rideId === 'string') {
        const winningRide = await deps.getItem(`RIDE#${winningPointer.rideId}`, 'DETAILS');
        if (winningRide) {
          logger.info('idempotency race lost; returning winning ride', {
            winningRideId: winningPointer.rideId,
          });
          emitEMFMetric(
            'RideDispatch/TripService',
            { Route: 'request-ride' },
            { RequestCount: { value: 1, unit: 'Count' } },
          );
          return {
            statusCode: 200,
            body: winningRide,
          };
        }
      }
    }
  }

  logger.info('ride requested successfully', {
    rideId,
    riderId,
    pickup: body.pickup,
    dropoff: body.dropoff,
  });

  emitEMFMetric(
    'RideDispatch/TripService',
    { Route: 'request-ride' },
    { RequestCount: { value: 1, unit: 'Count' } },
  );

  return {
    statusCode: 201,
    body: rideItem,
  };
}
