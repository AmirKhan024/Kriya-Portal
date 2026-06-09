/**
 * Dev A debug logging utility.
 *
 * Browser-visible console logging gated by NEXT_PUBLIC_DEBUG=true. Use it to trace
 * form steps and every API request/response so issues can be copied from the browser
 * console and pasted back for triage.
 *
 * Works on both client (browser console) and server (terminal). No-op in production
 * unless NEXT_PUBLIC_DEBUG is explicitly "true".
 */

const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG === 'true';

const PREFIX = '%c[kriya:devA]';
const STYLE = 'color:#2dd4bf;font-weight:600';

export function dbg(scope: string, ...args: unknown[]): void {
  if (!DEBUG_ENABLED) return;
  // eslint-disable-next-line no-console
  console.log(`${PREFIX} ${scope}`, STYLE, ...args);
}

export function dbgError(scope: string, ...args: unknown[]): void {
  if (!DEBUG_ENABLED) return;
  // eslint-disable-next-line no-console
  console.error(`[kriya:devA] ${scope}`, ...args);
}

/**
 * Run a function inside a collapsed console group, logging timing. Returns the
 * function's result. Safe (and transparent) when debugging is disabled.
 */
export async function dbgGroup<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!DEBUG_ENABLED) return fn();
  // eslint-disable-next-line no-console
  console.groupCollapsed(`${PREFIX} ${label}`, STYLE);
  const start = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    return await fn();
  } finally {
    if (start) {
      const ms = Math.round(performance.now() - start);
      // eslint-disable-next-line no-console
      console.log(`↳ done in ${ms}ms`);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
}

export const isDebugEnabled = DEBUG_ENABLED;
