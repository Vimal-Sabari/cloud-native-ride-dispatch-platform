import { createLogger } from '../src/logger';

describe('TypeScript Logger (pino wrapper)', () => {
  it('emits service name and merges structured fields', () => {
    const lines: string[] = [];
    const destination = {
      write(msg: string) {
        lines.push(msg);
      },
    };

    const logger = createLogger('trip-service', destination);
    logger.info('ride created', { rideId: 'ride-123', riderId: 'rider-456' });

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.service).toBe('trip-service');
    expect(parsed.msg).toBe('ride created');
    expect(parsed.rideId).toBe('ride-123');
    expect(parsed.riderId).toBe('rider-456');
    expect(parsed.correlationId).toBeUndefined();
  });

  it('propagates correlation ID via withCorrelationId', () => {
    const lines: string[] = [];
    const destination = {
      write(msg: string) {
        lines.push(msg);
      },
    };

    const baseLogger = createLogger('notification-service', destination);
    const scopedLogger = baseLogger.withCorrelationId('corr-abc-789');

    scopedLogger.warn('connection timeout', { attempt: 3 });

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.service).toBe('notification-service');
    expect(parsed.correlationId).toBe('corr-abc-789');
    expect(parsed.msg).toBe('connection timeout');
    expect(parsed.attempt).toBe(3);
  });

  it('includes error message and stack on error logs', () => {
    const lines: string[] = [];
    const destination = {
      write(msg: string) {
        lines.push(msg);
      },
    };

    const logger = createLogger('trip-service', destination).withCorrelationId('req-111');
    const err = new Error('database write condition failed');

    logger.error('failed updating state', err, { status: 'requested' });

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.service).toBe('trip-service');
    expect(parsed.correlationId).toBe('req-111');
    expect(parsed.msg).toBe('failed updating state');
    expect(parsed.error).toBe('database write condition failed');
    expect(parsed.stack).toBeDefined();
    expect(parsed.status).toBe('requested');
  });
});
