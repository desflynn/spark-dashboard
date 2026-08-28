// Pure, DOM-free helpers for the fleet dashboard view. Kept side-effect free
// so they can be unit-tested in isolation (see fleet.test.ts).

/** One sample of a metric time series. Mirrors the wire/history point shape. */
export interface DataPoint {
  timestamp: number
  value: number
}

/** Design-token colors. These are the exact `oklch()` values from the concept
 *  mock — keep them in sync with REDESIGN-SPEC.md. */
export const GOOD = 'oklch(0.80 0.18 140)' // green
export const COOL = 'oklch(0.78 0.13 225)' // blue
export const WARN = 'oklch(0.80 0.16 78)' // amber
export const CRIT = 'oklch(0.66 0.20 27)' // red

/** The window the "5-min average" big numbers are computed over. Matches the
 *  300 s window the backend's history buffers are already trimmed to. */
export const FIVE_MIN_MS = 300_000

/**
 * Format a rate/count the way the mock renders big numbers:
 *   >= 1e6  -> "130.1M"   >= 1e3 -> "4.3k"   >= 100 -> integer   else -> 1 decimal.
 * Trailing ".0" on the k/M form is dropped. Non-finite input collapses to 0 so
 * the cell never shows "NaN".
 */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  if (n >= 100) return Math.round(n).toString()
  return n.toFixed(1)
}

/** Seconds with exactly one decimal, e.g. TTFT "4.3 s". */
export function fmtSeconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/**
 * Mean of the points inside the trailing 5-minute window (timestamp >=
 * nowMs − 300000). Returns null when nothing qualifies, so callers can show
 * "—" instead of a zero. `nowMs` is injected (snapshot timestamp) rather than
 * read from Date.now() so the value is deterministic.
 */
export function windowedMean(
  points: readonly DataPoint[],
  nowMs: number,
): number | null {
  let sum = 0
  let count = 0
  const cutoff = nowMs - FIVE_MIN_MS
  for (const p of points) {
    if (p.timestamp >= cutoff) {
      sum += p.value
      count++
    }
  }
  return count === 0 ? null : sum / count
}

/**
 * Sum several time series into one, aligning by timestamp. Used to fold the
 * per-engine series of the "All" tab into a single composite series before
 * averaging. Series with no points contribute nothing.
 */
export function sumSeries(arrays: readonly DataPoint[][]): DataPoint[] {
  const byTs = new Map<number, number>()
  for (const series of arrays) {
    for (const p of series) {
      byTs.set(p.timestamp, (byTs.get(p.timestamp) ?? 0) + p.value)
    }
  }
  return Array.from(byTs.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, value]) => ({ timestamp, value }))
}

/** First-token color scale: <= 0.5 s GOOD, <= 2 s WARN, else CRIT (input ms). */
export function firstTokColor(ms: number): string {
  if (ms <= 500) return GOOD
  if (ms <= 2000) return WARN
  return CRIT
}

/** Whole-answer (e2e) color scale: <= 5 s GOOD, <= 15 s WARN, else CRIT (ms). */
export function wholeAnswerColor(ms: number): string {
  if (ms <= 5000) return GOOD
  if (ms <= 15000) return WARN
  return CRIT
}

/** Goodput-chip color: >= 90% GOOD, >= 50% WARN, else CRIT. */
export function goodputColor(pct: number): string {
  if (pct >= 90) return GOOD
  if (pct >= 50) return WARN
  return CRIT
}

/** Speculative-decoding TAR color: >= 60% GOOD, >= 30% WARN, else CRIT. */
export function tarColor(pct: number): string {
  if (pct >= 60) return GOOD
  if (pct >= 30) return WARN
  return CRIT
}

/** Memory-free color (GB): < 8 CRIT, < 24 WARN, else GOOD. */
export function memFreeColor(freeGb: number): string {
  if (freeGb < 8) return CRIT
  if (freeGb < 24) return WARN
  return GOOD
}

/** Queue color: empty GOOD, < 8 WARN, else CRIT. */
export function queueColor(queued: number): string {
  if (queued === 0) return GOOD
  if (queued < 8) return WARN
  return CRIT
}

/** GPU temperature color: < 70 GOOD, < 85 WARN, else CRIT. */
export function gpuTempColor(celsius: number): string {
  if (celsius < 70) return GOOD
  if (celsius < 85) return WARN
  return CRIT
}

/**
 * Turn an `oklch(l a h)` token into a version with an explicit alpha, e.g.
 * `oklch(0.80 0.18 140)` + 0.08 -> `oklch(0.80 0.18 140 / 0.08)` — the fill and
 * border the goodput chips use. `a` is rendered as written ("0.08").
 */
export function alpha(color: string, a: number): string {
  // CSS Color 5 alpha syntax: `oklch(0.8 0.18 140 / 0.12)` — the slash goes
  // inside the function, space-separated. A trailing `) / 0.12` is invalid.
  if (color.endsWith(')')) {
    return `${color.slice(0, -1)} / ${a})`
  }
  return `${color} / ${a}`
}
