// Shared event bus so relay/brain/state can push into the dashboard
// without a hard dependency on the monitor server.

type Listener<T> = (v: T) => void;

class Bus<T> {
  private ls: Listener<T>[] = [];
  on(cb: Listener<T>) { this.ls.push(cb); return () => { this.ls = this.ls.filter(x => x !== cb); }; }
  emit(v: T) { for (const cb of this.ls) cb(v); }
}

export interface LogLine { ts: number; line: string; }
export const logBus = new Bus<LogLine>();

// Wrap console.log/warn/error to fan out to dashboard.
// Preserves original terminal output.
const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _err = console.error.bind(console);

const RING: LogLine[] = [];
const MAX = 500;
export function recentLogs(): LogLine[] { return [...RING]; }

function fmt(args: unknown[]): string {
  return args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ');
}

function push(line: string) {
  const e: LogLine = { ts: Date.now(), line };
  RING.push(e);
  if (RING.length > MAX) RING.shift();
  logBus.emit(e);
}

console.log = (...a: unknown[]) => { _log(...a); push(fmt(a)); };
console.warn = (...a: unknown[]) => { _warn(...a); push('⚠ ' + fmt(a)); };
console.error = (...a: unknown[]) => { _err(...a); push('❌ ' + fmt(a)); };
