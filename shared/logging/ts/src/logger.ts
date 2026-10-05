import pino, { DestinationStream } from 'pino';

export interface Logger {
  withCorrelationId(id: string): Logger;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, err?: Error, fields?: Record<string, unknown>): void;
}

class PinoLoggerWrapper implements Logger {
  private readonly pinoInstance: pino.Logger;

  constructor(pinoInstance: pino.Logger) {
    this.pinoInstance = pinoInstance;
  }

  withCorrelationId(id: string): Logger {
    return new PinoLoggerWrapper(this.pinoInstance.child({ correlationId: id }));
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    if (fields) {
      this.pinoInstance.info(fields, msg);
    } else {
      this.pinoInstance.info(msg);
    }
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    if (fields) {
      this.pinoInstance.warn(fields, msg);
    } else {
      this.pinoInstance.warn(msg);
    }
  }

  error(msg: string, err?: Error, fields?: Record<string, unknown>): void {
    const merged: Record<string, unknown> = { ...fields };
    if (err) {
      merged.error = err.message;
      merged.stack = err.stack;
    }
    if (Object.keys(merged).length > 0) {
      this.pinoInstance.error(merged, msg);
    } else {
      this.pinoInstance.error(msg);
    }
  }
}

/**
 * createLogger initializes a structured pino-backed logger with a base service field.
 * An optional destination can be provided for unit testing log capture.
 */
export function createLogger(serviceName: string, destination?: DestinationStream): Logger {
  const p = destination
    ? pino({ base: { service: serviceName } }, destination)
    : pino({ base: { service: serviceName } });
  return new PinoLoggerWrapper(p);
}
