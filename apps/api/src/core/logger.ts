import { env } from '../env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold: LogLevel = env.NODE_ENV === 'production' ? 'info' : 'debug';

interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ?? {}),
  };
  const sink = level === 'error' || level === 'warn' ? console.error : console.log;
  if (env.NODE_ENV === 'production') {
    sink(JSON.stringify(line));
  } else {
    const extra = context && Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
    sink(`[${level}] ${message}${extra}`);
  }
}

export const log = {
  debug: (m: string, c?: LogContext) => emit('debug', m, c),
  info: (m: string, c?: LogContext) => emit('info', m, c),
  warn: (m: string, c?: LogContext) => emit('warn', m, c),
  error: (m: string, c?: LogContext) => emit('error', m, c),
};

/** Times an operation and logs its duration — used across the scan pipeline. */
export async function time<T>(label: string, fn: () => Promise<T>, context?: LogContext): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log.debug(`${label} completed`, { ...context, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    log.error(`${label} failed`, {
      ...context,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
