import type { Logger } from '../application/ports.js';

type Level = 'info' | 'warn' | 'error';

/** One JSON object per line, ready for any log collector. Error values (and their causes) are expanded. */
export function createLogger(base: Record<string, unknown>): Logger {
  const write = (level: Level, message: string, fields?: Record<string, unknown>) => {
    const entry = { time: new Date().toISOString(), level, message, ...base, ...fields };
    const line = JSON.stringify(entry, (_key, value: unknown) => (value instanceof Error ? serializeError(value) : value));
    if (level === 'info') console.log(line);
    else console.error(line);
  };
  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

function serializeError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause !== undefined && { cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause }),
  };
}
