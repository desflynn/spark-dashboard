// Pure, DOM-free helpers for the fleet dashboard view. Kept side-effect free
// so they can be unit-tested in isolation (see fleet.test.ts).

/** One sample of a metric time series. Mirrors the wire/history point shape. */
export interface DataPoint {
  timestamp: number
  value: number
  /** Elapsed time represented by this rate sample. */
  durationMs?: number
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

export function fmtOptional(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : fmt(n)
}

interface MemoryBreakdownInput {
  displayTotalBytes: number
  kernelTotalBytes: number
  usedBytes: number
  availableBytes: number
  cachedBytes: number
  gpuEstimatedBytes: number | null
}

export interface MemoryBreakdown {
  gpuBytes: number
  hostBytes: number
  cacheBytes: number
  reservedBytes: number
  freeBytes: number
  inUseBytes: number
}

export function memoryBreakdown(input: MemoryBreakdownInput): MemoryBreakdown {
  const kernelCapacity = Math.min(input.displayTotalBytes, input.kernelTotalBytes)
  const inUseBytes = Math.max(0, Math.min(input.usedBytes, kernelCapacity))
  const gpuBytes = Math.max(0, Math.min(input.gpuEstimatedBytes ?? 0, inUseBytes))
  const cacheBytes = Math.max(0, Math.min(input.cachedBytes, inUseBytes - gpuBytes))
  const hostBytes = inUseBytes - gpuBytes - cacheBytes

  return {
    gpuBytes,
    hostBytes,
    cacheBytes,
    reservedBytes: Math.max(0, input.displayTotalBytes - kernelCapacity),
    freeBytes: Math.max(0, Math.min(input.availableBytes, kernelCapacity - inUseBytes)),
    inUseBytes,
  }
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

function representedInterval(
  points: readonly DataPoint[],
  index: number,
): [number, number] | null {
  const point = points[index]
  const inferred = index > 0 ? point.timestamp - points[index - 1].timestamp : 0
  const duration = point.durationMs ?? inferred
  if (duration <= 0) return null
  return [point.timestamp - duration, point.timestamp]
}

/** Active-time mean of a rate over the trailing five minutes. */
export function activeWindowMean(
  points: readonly DataPoint[],
  nowMs: number,
): number | null {
  const cutoff = nowMs - FIVE_MIN_MS
  let observedMs = 0
  let activeMs = 0
  let weighted = 0

  for (let i = 0; i < points.length; i++) {
    const interval = representedInterval(points, i)
    if (!interval) continue
    const start = Math.max(cutoff, interval[0])
    const end = Math.min(nowMs, interval[1])
    if (end <= start) continue

    const duration = end - start
    observedMs += duration
    if (points[i].value > 0) {
      activeMs += duration
      weighted += points[i].value * duration
    }
  }

  if (observedMs === 0) return null
  return activeMs === 0 ? 0 : weighted / activeMs
}

/** Active-time mean after summing concurrent engine-rate intervals. */
export function activeFleetWindowMean(
  series: readonly (readonly DataPoint[])[],
  nowMs: number,
): number | null {
  const cutoff = nowMs - FIVE_MIN_MS
  const events: Array<[number, number]> = []
  let observed = false

  for (const points of series) {
    for (let i = 0; i < points.length; i++) {
      const interval = representedInterval(points, i)
      if (!interval) continue
      const start = Math.max(cutoff, interval[0])
      const end = Math.min(nowMs, interval[1])
      if (end <= start) continue
      observed = true
      events.push([start, points[i].value], [end, -points[i].value])
    }
  }

  if (!observed) return null
  events.sort((a, b) => a[0] - b[0])

  let current = 0
  let previous = events[0][0]
  let activeMs = 0
  let weighted = 0
  for (let i = 0; i < events.length;) {
    const timestamp = events[i][0]
    const duration = timestamp - previous
    if (current > 0 && duration > 0) {
      activeMs += duration
      weighted += current * duration
    }
    while (i < events.length && events[i][0] === timestamp) {
      current += events[i][1]
      i++
    }
    previous = timestamp
  }

  return activeMs === 0 ? 0 : weighted / activeMs
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

export function sumConcurrentSeries(
  series: readonly (readonly DataPoint[])[],
): DataPoint[] {
  const events: Array<[number, number]> = []
  for (const points of series) {
    for (let i = 0; i < points.length; i++) {
      const interval = representedInterval(points, i)
      if (!interval) continue
      events.push([interval[0], points[i].value], [interval[1], -points[i].value])
    }
  }

  events.sort((a, b) => a[0] - b[0])
  const result: DataPoint[] = []
  let current = 0
  for (let i = 0; i < events.length;) {
    const timestamp = events[i][0]
    while (i < events.length && events[i][0] === timestamp) {
      current += events[i][1]
      i++
    }
    result.push({ timestamp, value: current })
  }
  return result
}

interface WeightedSeriesInput {
  values: readonly DataPoint[]
  weights: readonly DataPoint[]
}

export function weightedSeries(series: readonly WeightedSeriesInput[]): DataPoint[] {
  const samples = series.map(({ values, weights }) => {
    const weightByTimestamp = new Map(weights.map((point) => [point.timestamp, point.value]))
    return values.flatMap((point) => {
      const weight = weightByTimestamp.get(point.timestamp)
      return weight !== undefined && weight > 0 ? [{ ...point, weight }] : []
    })
  })
  const timestamps = [...new Set(samples.flatMap((points) => points.map((point) => point.timestamp)))]
    .sort((a, b) => a - b)
  const indexes = samples.map(() => -1)

  return timestamps.flatMap((timestamp) => {
    let weighted = 0
    let weight = 0
    for (let i = 0; i < samples.length; i++) {
      while (indexes[i] + 1 < samples[i].length && samples[i][indexes[i] + 1].timestamp <= timestamp) {
        indexes[i]++
      }
      const point = samples[i][indexes[i]]
      if (point) {
        weighted += point.value * point.weight
        weight += point.weight
      }
    }
    return weight > 0 ? [{ timestamp, value: weighted / weight }] : []
  })
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
