import { config } from '../config.js';

const levels: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = levels[config.LOG_LEVEL] ?? 20;

function emit(level: string, msg: string, extra?: Record<string, unknown>) {
  if ((levels[level] ?? 20) < threshold) return;
  const line = { t: new Date().toISOString(), level, role: config.ROLE, msg, ...extra };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

export const log = {
  debug: (m: string, e?: Record<string, unknown>) => emit('debug', m, e),
  info: (m: string, e?: Record<string, unknown>) => emit('info', m, e),
  warn: (m: string, e?: Record<string, unknown>) => emit('warn', m, e),
  error: (m: string, e?: Record<string, unknown>) => emit('error', m, e)
};
