import { useRef, useState, useCallback, useEffect } from 'react'
import { CircularBuffer } from '../lib/circular-buffer'
import { engineKey, gpuIndexOf, snapshotGpus } from '../lib/identity'
import type { MetricsSnapshot, GpuEventData, InferenceRequestData } from '../types/metrics'

interface DataPoint {
  timestamp: number
  value: number
  durationMs?: number
}

const BUFFER_CAPACITY = 900 // 15 minutes at 1 sample/sec

/** Rect points for a [start, end] window at `rate`. Interior points every 2s
 *  keep consecutive gaps under AreaSparkline's 2.5s segment-break threshold —
 *  without them a wide block renders as two disconnected vertical edges (no
 *  top, no fill). */
function emitRect(
  pts: { timestamp: number; value: number }[],
  start_ms: number,
  end_ms: number,
  rate: number,
  cutoff: number,
) {
  const s = Math.max(start_ms, cutoff)
  pts.push({ timestamp: s - 1, value: 0 })
  pts.push({ timestamp: s, value: rate })
  for (let t = s + 2000; t < end_ms; t += 2000) {
    pts.push({ timestamp: t, value: rate })
  }
  pts.push({ timestamp: end_ms, value: rate })
  pts.push({ timestamp: end_ms + 1, value: 0 })
}

const EVENT_BUFFER_CAPACITY = 100
const REQUEST_BUFFER_CAPACITY = 50

type MetricKey =
  | 'gpuUtil'
  | 'gpuTemp'
  | 'gpuPower'
  | 'gpuClockGraphics'
  | 'cpuAggregate'
  | 'memoryUsedPercent'
  | 'diskRead'
  | 'diskWrite'
  | 'networkRx'
  | 'networkTx'

const SYSTEM_METRIC_KEYS: MetricKey[] = [
  'gpuUtil',
  'gpuTemp',
  'gpuPower',
  'gpuClockGraphics',
  'cpuAggregate',
  'memoryUsedPercent',
  'diskRead',
  'diskWrite',
  'networkRx',
  'networkTx',
]

function createBuffers(): Record<MetricKey, CircularBuffer<DataPoint>> {
  const buffers = {} as Record<MetricKey, CircularBuffer<DataPoint>>
  for (const key of SYSTEM_METRIC_KEYS) {
    buffers[key] = new CircularBuffer<DataPoint>(BUFFER_CAPACITY)
  }
  return buffers
}

function extractGpuValue(gpu: MetricsSnapshot['gpu'], key: MetricKey): number | null {
  switch (key) {
    case 'gpuUtil':
      return gpu.utilization_percent
    case 'gpuTemp':
      return gpu.temperature_celsius
    case 'gpuPower':
      return gpu.power_watts
    case 'gpuClockGraphics':
      return gpu.clock_graphics_mhz
    default:
      return null
  }
}

function extractValue(metrics: MetricsSnapshot, key: MetricKey): number | null {
  switch (key) {
    case 'gpuUtil':
    case 'gpuTemp':
    case 'gpuPower':
    case 'gpuClockGraphics':
      return extractGpuValue(metrics.gpu, key)
    case 'cpuAggregate':
      return metrics.cpu.aggregate_percent
    case 'memoryUsedPercent':
      return metrics.memory.total_bytes > 0
        ? (metrics.memory.used_bytes / metrics.memory.total_bytes) * 100
        : null
    case 'diskRead':
      return metrics.disk.read_bytes_per_sec
    case 'diskWrite':
      return metrics.disk.write_bytes_per_sec
    case 'networkRx':
      return metrics.network.rx_bytes_per_sec
    case 'networkTx':
      return metrics.network.tx_bytes_per_sec
  }
}

const DEFAULT_WINDOW_SECONDS = 300 // 5 minutes

export function useMetricsHistory(
  metrics: MetricsSnapshot | null,
) {
  const buffersRef = useRef(createBuffers())
  const gpuBuffersRef = useRef<
    Record<string, Record<MetricKey, CircularBuffer<DataPoint>>>
  >({})
  const engineBuffersRef = useRef<
    Record<string, Record<string, CircularBuffer<DataPoint>>>
  >({})
  const lastEngineTimestampRef = useRef<Record<string, number>>({})
  const lastPurePrefillRef = useRef<Record<string, { tokens: number; ts: number }>>({})
  // Completed-prefill events per engine, materialized into sparkline pulses
  // in `getPpChart`. Backend has no per-request stream, so we reconstruct the
  // pulse from `pure_prefill_tokens` deltas + `last_req_pp`:
  //   duration = dtok / rate,  start = end - duration.
  const ppEventsRef = useRef<
    Record<string, CircularBuffer<{ start_ms: number; end_ms: number; rate: number }>>
  >({})
  // Grey "prefill working" windows. Raised when the engine leaves idle
  // (active_requests 0→N) or when a completion record lands while another
  // request is already running (back-to-back — running never dips to zero).
  // Height is frozen at the 5-min PP average; the window drops at the first
  // generation movement (prefill done, TTFT gap included), when the completion
  // record lands with no generation ever seen (zero-output fallback), or when
  // active_requests falls back to zero (aborted request). Materialized as
  // grey rectangles by `getPpGreyChart`, including the still-open window.
  const ppWorkingRef = useRef<Record<string, { startTs: number; height: number } | null>>({})
  const greyEventsRef = useRef<
    Record<string, CircularBuffer<{ start_ms: number; end_ms: number; rate: number }>>
  >({})
  const lastActiveRef = useRef<Record<string, number>>({})
  const lastCompletionRef = useRef<Record<string, number>>({})
  const genSinceCompletionRef = useRef<Record<string, boolean>>({})
  // Closed grey windows awaiting their completion record: the green block
  // backfills exactly this [grey start → PP end] window and deletes the grey.
  const pendingRef = useRef<Record<string, { startTs: number; endTs: number } | null>>({})
  const eventBufferRef = useRef(
    new CircularBuffer<GpuEventData>(EVENT_BUFFER_CAPACITY),
  )
  const requestBuffersRef = useRef<
    Record<string, CircularBuffer<InferenceRequestData>>
  >({})
  const lastTimestampRef = useRef<number>(0)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!metrics || metrics.timestamp_ms <= lastTimestampRef.current) return
    const ts = metrics.timestamp_ms
    const previousTs = lastTimestampRef.current
    lastTimestampRef.current = ts
    const durationMs = previousTs > 0 && ts > previousTs ? ts - previousTs : 0
    const buffers = buffersRef.current

    for (const key of SYSTEM_METRIC_KEYS) {
      const val = extractValue(metrics, key)
      if (val !== null) {
        buffers[key].push({ timestamp: ts, value: val, durationMs })
      }
    }

    for (const gpu of snapshotGpus(metrics)) {
      const gpuKey = String(gpuIndexOf(gpu))
      if (!gpuBuffersRef.current[gpuKey]) {
        gpuBuffersRef.current[gpuKey] = createBuffers()
      }
      const gb = gpuBuffersRef.current[gpuKey]
      for (const key of ['gpuUtil', 'gpuTemp', 'gpuPower', 'gpuClockGraphics'] as MetricKey[]) {
        const val = extractGpuValue(gpu, key)
        if (val !== null) {
          gb[key].push({ timestamp: ts, value: val, durationMs })
        }
      }
    }

    // Engine-specific metrics
    for (const engine of metrics.engines) {
      const key = engineKey(engine)
      const engineTs = engine.sampled_at_ms
      if (engineTs === null || engineTs <= (lastEngineTimestampRef.current[key] ?? 0)) continue
      lastEngineTimestampRef.current[key] = engineTs
      if (!engineBuffersRef.current[key]) {
        engineBuffersRef.current[key] = {
          tps: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          avgTps: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          perReqTps: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ttft: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ttftObservations: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          kvCache: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          prefixCacheHit: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          e2eLatency: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          e2eObservations: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ppLastReq: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ppInstant: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          pp5min: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ppLifetime: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          tgLastReq: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          queueTime: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          interTokenLatency: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          itlObservations: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          batchSize: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ttftP50: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ttftP95: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          ttftP99: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          itlP50: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          itlP95: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          itlP99: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          e2eP50: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          e2eP95: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          e2eP99: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          tpot: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          tpotObservations: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          tpotP50: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          tpotP95: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          tpotP99: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          activeRequests: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          queuedRequests: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
          totalRequests: new CircularBuffer<DataPoint>(BUFFER_CAPACITY),
        }
      }
      const eb = engineBuffersRef.current[key]
      if (engine.metrics) {
        if (engine.metrics.tokens_per_sec !== null) {
          eb.tps.push({
            timestamp: engineTs,
            value: engine.metrics.tokens_per_sec,
            durationMs: engine.metrics.tokens_per_sec_interval_ms ?? 0,
          })
        }
        if (engine.metrics.avg_tokens_per_sec !== null) {
          eb.avgTps.push({ timestamp: engineTs, value: engine.metrics.avg_tokens_per_sec })
        }
        if (engine.metrics.per_request_tps !== null) {
          eb.perReqTps.push({ timestamp: engineTs, value: engine.metrics.per_request_tps })
        }
        if (engine.metrics.ttft_ms !== null) {
          eb.ttft.push({ timestamp: engineTs, value: engine.metrics.ttft_ms })
        }
        if (engine.metrics.ttft_observations !== null) {
          eb.ttftObservations.push({ timestamp: engineTs, value: engine.metrics.ttft_observations })
        }
        if (engine.metrics.kv_cache_percent !== null) {
          eb.kvCache.push({
            timestamp: engineTs,
            value: engine.metrics.kv_cache_percent,
          })
        }
        if (engine.metrics.prefix_cache_hit_rate !== null) {
          eb.prefixCacheHit.push({
            timestamp: engineTs,
            value: engine.metrics.prefix_cache_hit_rate,
          })
        }
        if (engine.metrics.e2e_latency_ms !== null) {
          eb.e2eLatency.push({ timestamp: engineTs, value: engine.metrics.e2e_latency_ms })
        }
        if (engine.metrics.e2e_observations !== null) {
          eb.e2eObservations.push({ timestamp: engineTs, value: engine.metrics.e2e_observations })
        }
        if (engine.metrics.last_req_pp !== null) {
          eb.ppLastReq.push({ timestamp: engineTs, value: engine.metrics.last_req_pp })
        }
        // Prefill pulse reconstruction.
        //  - Poll-interval rate → `ppInstant` (zero when idle). Used by the
        //    old sparkline path and by anything that wants a per-poll trace.
        //  - True [start, end] rectangle → `ppEvents`, materialised into the
        //    sparkline by `getPpChart`. Duration = dtok / last_req_pp so the
        //    pulse reflects how long the prefill actually ran, not just the
        //    one poll where the counter jumped. The completion record lands
        //    in the poll after the prefill ends, so the rectangle is anchored
        //    at end = poll time and reaches back the full true duration.
        let completedThisPoll = false
        let completion: { dtok: number; trueRate: number } | null = null
        if (engine.metrics.pure_prefill_tokens !== null) {
          const cur = engine.metrics.pure_prefill_tokens
          const prev = lastPurePrefillRef.current[key]
          if (prev && engineTs > prev.ts) {
            const dtok = cur - prev.tokens
            const dsec = (engineTs - prev.ts) / 1000
            const rate = dtok > 0 && dsec > 0 ? dtok / dsec : 0
            eb.ppInstant.push({ timestamp: engineTs, value: rate })
            if (dtok > 0) {
              completedThisPoll = true
              completion = { dtok, trueRate: engine.metrics.last_req_pp ?? 0 }
            }
          }
          lastPurePrefillRef.current[key] = { tokens: cur, ts: engineTs }
        }
        // Grey "working" latch — see ppWorkingRef for the state machine.
        // ponytail: concurrent decode + prefill closes the grey window early
        // (genMoved is engine-wide, not per-request); per-request lanes only
        // if overlapping requests become the norm.
        if (engine.metrics.active_requests !== null) {
          const active = engine.metrics.active_requests
          const prevActive = lastActiveRef.current[key] ?? 0
          lastActiveRef.current[key] = active
          const tpsNow = engine.metrics.tokens_per_sec ?? 0
          if (completedThisPoll) {
            lastCompletionRef.current[key] = engineTs
            genSinceCompletionRef.current[key] = false
          }
          if (tpsNow > 0) genSinceCompletionRef.current[key] = true
          const working = ppWorkingRef.current[key] ?? null
          if (working && (tpsNow > 0 || completedThisPoll || (active === 0 && prevActive > 0))) {
            if (engineTs > working.startTs) {
              if (!greyEventsRef.current[key]) {
                greyEventsRef.current[key] = new CircularBuffer(200)
              }
              greyEventsRef.current[key].push({
                start_ms: working.startTs,
                end_ms: engineTs,
                rate: working.height,
              })
              // Keep the observed window so the green block that replaces
              // this grey lands exactly on [grey start → PP end].
              pendingRef.current[key] = { startTs: working.startTs, endTs: engineTs }
            }
            ppWorkingRef.current[key] = null
          }
          // Backfill: the completion record replaces the grey placeholder with
          // the true prefill block — same window the grey covered, height =
          // engine-reported prefill rate — and deletes the grey it covered.
          const pending = pendingRef.current[key] ?? null
          if (completedThisPoll && pending) {
            pendingRef.current[key] = null
            if (completion && completion.trueRate > 0) {
              if (!ppEventsRef.current[key]) {
                ppEventsRef.current[key] = new CircularBuffer(200)
              }
              ppEventsRef.current[key].push({
                start_ms: pending.startTs,
                end_ms: pending.endTs,
                rate: completion.trueRate,
              })
              const buf = greyEventsRef.current[key]
              if (buf) {
                const all = buf.toArray()
                const kept = all.filter(
                  (g) => g.end_ms <= pending.startTs || g.start_ms >= pending.endTs,
                )
                if (kept.length !== all.length) {
                  buf.clear()
                  for (const g of kept) buf.push(g)
                }
              }
            }
          } else if (completedThisPoll && completion && completion.trueRate > 0) {
            // No pending window (request arrived and completed without an
            // observed working phase): reconstruct from duration.
            if (!ppEventsRef.current[key]) {
              ppEventsRef.current[key] = new CircularBuffer(200)
            }
            const durationMs = (completion.dtok / completion.trueRate) * 1000
            ppEventsRef.current[key].push({
              start_ms: engineTs - durationMs,
              end_ms: engineTs,
              rate: completion.trueRate,
            })
          }
          // Chained entry: a completion recently landed while another request
          // is already running. Deferred one poll and gated on "no generation
          // has flowed since that completion" — the request still running at
          // the completion poll may be the completed one itself mid-decode,
          // which must not raise grey.
          const completionTs = lastCompletionRef.current[key]
          const chainedEntry = completionTs !== undefined
            && engineTs > completionTs
            && engineTs - completionTs <= 5_000
            && !(genSinceCompletionRef.current[key] ?? false)
          if ((ppWorkingRef.current[key] ?? null) === null && active > 0 && tpsNow === 0) {
            const idleEntry = prevActive === 0
            if (idleEntry || chainedEntry) {
              ppWorkingRef.current[key] = {
                startTs: engineTs,
                height: engine.metrics.pp_5min ?? engine.metrics.last_req_pp ?? 0,
              }
            }
          }
        }
        if (engine.metrics.pp_5min !== null) {
          eb.pp5min.push({ timestamp: engineTs, value: engine.metrics.pp_5min })
        }
        if (engine.metrics.pp_lifetime !== null) {
          eb.ppLifetime.push({ timestamp: engineTs, value: engine.metrics.pp_lifetime })
        }
        if (engine.metrics.last_req_tg !== null) {
          eb.tgLastReq.push({ timestamp: engineTs, value: engine.metrics.last_req_tg })
        }
        if (engine.metrics.queue_time_ms !== null) {
          eb.queueTime.push({ timestamp: engineTs, value: engine.metrics.queue_time_ms })
        }
        if (engine.metrics.inter_token_latency_ms !== null) {
          eb.interTokenLatency.push({ timestamp: engineTs, value: engine.metrics.inter_token_latency_ms })
        }
        if (engine.metrics.itl_observations !== null) {
          eb.itlObservations.push({ timestamp: engineTs, value: engine.metrics.itl_observations })
        }
        if (engine.metrics.avg_batch_size !== null) {
          eb.batchSize.push({ timestamp: engineTs, value: engine.metrics.avg_batch_size })
        }
        if (engine.metrics.tpot_ms !== null) {
          eb.tpot.push({ timestamp: engineTs, value: engine.metrics.tpot_ms })
        }
        if (engine.metrics.tpot_observations !== null) {
          eb.tpotObservations.push({ timestamp: engineTs, value: engine.metrics.tpot_observations })
        }
        const tp = engine.metrics.ttft_percentiles
        if (tp) {
          if (tp.p50_ms !== null) eb.ttftP50.push({ timestamp: engineTs, value: tp.p50_ms })
          if (tp.p95_ms !== null) eb.ttftP95.push({ timestamp: engineTs, value: tp.p95_ms })
          if (tp.p99_ms !== null) eb.ttftP99.push({ timestamp: engineTs, value: tp.p99_ms })
        }
        const ip = engine.metrics.itl_percentiles
        if (ip) {
          if (ip.p50_ms !== null) eb.itlP50.push({ timestamp: engineTs, value: ip.p50_ms })
          if (ip.p95_ms !== null) eb.itlP95.push({ timestamp: engineTs, value: ip.p95_ms })
          if (ip.p99_ms !== null) eb.itlP99.push({ timestamp: engineTs, value: ip.p99_ms })
        }
        const ep = engine.metrics.e2e_percentiles
        if (ep) {
          if (ep.p50_ms !== null) eb.e2eP50.push({ timestamp: engineTs, value: ep.p50_ms })
          if (ep.p95_ms !== null) eb.e2eP95.push({ timestamp: engineTs, value: ep.p95_ms })
          if (ep.p99_ms !== null) eb.e2eP99.push({ timestamp: engineTs, value: ep.p99_ms })
        }
        const pp = engine.metrics.tpot_percentiles
        if (pp) {
          if (pp.p50_ms !== null) eb.tpotP50.push({ timestamp: engineTs, value: pp.p50_ms })
          if (pp.p95_ms !== null) eb.tpotP95.push({ timestamp: engineTs, value: pp.p95_ms })
          if (pp.p99_ms !== null) eb.tpotP99.push({ timestamp: engineTs, value: pp.p99_ms })
        }
        if (engine.metrics.active_requests !== null) {
          eb.activeRequests.push({ timestamp: engineTs, value: engine.metrics.active_requests })
        }
        if (engine.metrics.queued_requests !== null) {
          eb.queuedRequests.push({ timestamp: engineTs, value: engine.metrics.queued_requests })
        }
        if (engine.metrics.total_requests !== null) {
          eb.totalRequests.push({ timestamp: engineTs, value: engine.metrics.total_requests })
        }
      }

      // Accumulate per-engine inference requests
      if (engine.recent_requests && engine.recent_requests.length > 0) {
        if (!requestBuffersRef.current[key]) {
          requestBuffersRef.current[key] =
            new CircularBuffer<InferenceRequestData>(REQUEST_BUFFER_CAPACITY)
        }
        for (const req of engine.recent_requests) {
          requestBuffersRef.current[key].push(req)
        }
      }
    }

    // Accumulate GPU events
    if (metrics.gpu_events && metrics.gpu_events.length > 0) {
      for (const event of metrics.gpu_events) {
        eventBufferRef.current.push(event)
      }
    }

    setVersion((v) => v + 1)
  }, [metrics])

  const getChartData = useCallback(
    (metric: string): DataPoint[] => {
      // Force dependency on version for reactivity
      void version

      const windowMs = DEFAULT_WINDOW_SECONDS * 1000
      const now = lastTimestampRef.current
      const cutoff = now - windowMs

      // Check system metrics
      const systemBuffer =
        buffersRef.current[metric as MetricKey]
      if (systemBuffer) {
        return systemBuffer
          .toArray()
          .filter((dp) => dp.timestamp >= cutoff)
      }

      const gpuMatch = metric.match(/^gpu:(\d+):(gpuUtil|gpuTemp|gpuPower|gpuClockGraphics)$/)
      if (gpuMatch) {
        const gb = gpuBuffersRef.current[gpuMatch[1]]
        const buffer = gb?.[gpuMatch[2] as MetricKey]
        if (buffer) {
          return buffer
            .toArray()
            .filter((dp) => dp.timestamp >= cutoff)
        }
      }

      // Check engine metrics (format: "engineKey:metricName")
      const colonIndex = metric.lastIndexOf(':')
      if (colonIndex > 0) {
        const key = metric.substring(0, colonIndex)
        const metricName = metric.substring(colonIndex + 1)
        const eb = engineBuffersRef.current[key]
        if (eb && eb[metricName]) {
          return eb[metricName]
            .toArray()
            .filter((dp) => dp.timestamp >= cutoff)
        }
      }

      return []
    },
    [version],
  )

  const getSparklineData = useCallback(
    (metric: string, count = 30): number[] => {
      void version

      const systemBuffer =
        buffersRef.current[metric as MetricKey]
      if (systemBuffer) {
        return systemBuffer.last(count).map((dp) => dp.value)
      }

      const gpuMatch = metric.match(/^gpu:(\d+):(gpuUtil|gpuTemp|gpuPower|gpuClockGraphics)$/)
      if (gpuMatch) {
        const gb = gpuBuffersRef.current[gpuMatch[1]]
        const buffer = gb?.[gpuMatch[2] as MetricKey]
        if (buffer) {
          return buffer.last(count).map((dp) => dp.value)
        }
      }

      const colonIndex = metric.lastIndexOf(':')
      if (colonIndex > 0) {
        const key = metric.substring(0, colonIndex)
        const metricName = metric.substring(colonIndex + 1)
        const eb = engineBuffersRef.current[key]
        if (eb && eb[metricName]) {
          return eb[metricName].last(count).map((dp) => dp.value)
        }
      }

      return []
    },
    [version],
  )

  /** PP sparkline as pulses: 0 → rate → rate → 0 spanning each completed
   *  prefill's [start, end] window. `key` narrows to one engine; omit for the
   *  fleet (events are concatenated across engines — visually overlapping
   *  rectangles, not a true concurrent sum). */
  const getPpChart = useCallback(
    (key?: string): DataPoint[] => {
      void version
      const windowMs = DEFAULT_WINDOW_SECONDS * 1000
      const now = lastTimestampRef.current
      const cutoff = now - windowMs
      const keys = key ? [key] : Object.keys(ppEventsRef.current)
      const pts: DataPoint[] = []
      for (const k of keys) {
        const buf = ppEventsRef.current[k]
        if (!buf) continue
        for (const e of buf.toArray()) {
          if (e.end_ms < cutoff) continue
          emitRect(pts, e.start_ms, e.end_ms, e.rate, cutoff)
        }
      }
      pts.sort((a, b) => a.timestamp - b.timestamp)
      return pts
    },
    [version],
  )

  /** Grey "working" rectangles for the PP sparkline: in-progress prefill
   *  windows at the frozen 5-min-average height, plus the still-open window
   *  drawn live up to `now`. `key` narrows to one engine; omit for the fleet. */
  const getPpGreyChart = useCallback(
    (key?: string): DataPoint[] => {
      void version
      const windowMs = DEFAULT_WINDOW_SECONDS * 1000
      const now = lastTimestampRef.current
      const cutoff = now - windowMs
      const keys = key ? [key] : Object.keys(greyEventsRef.current)
      const pts: DataPoint[] = []
      for (const k of keys) {
        const buf = greyEventsRef.current[k]
        if (buf) {
          for (const e of buf.toArray()) {
            if (e.end_ms < cutoff) continue
            emitRect(pts, e.start_ms, e.end_ms, e.rate, cutoff)
          }
        }
        const open = ppWorkingRef.current[k]
        if (open && now > open.startTs) emitRect(pts, open.startTs, now, open.height, cutoff)
      }
      pts.sort((a, b) => a.timestamp - b.timestamp)
      return pts
    },
    [version],
  )

  const getEvents = useCallback((): GpuEventData[] => {
    void version

    const windowMs = DEFAULT_WINDOW_SECONDS * 1000
    const now = lastTimestampRef.current
    const cutoff = now - windowMs

    return eventBufferRef.current
      .toArray()
      .filter((e) => e.timestamp_ms >= cutoff)
  }, [version])

  /** Recent requests, optionally narrowed to one engine. `key` is an engine
   *  key as produced by `engineKey()`; omit it for every engine's requests. */
  const getRequests = useCallback(
    (key?: string): InferenceRequestData[] => {
      void version

      const windowMs = DEFAULT_WINDOW_SECONDS * 1000
      const now = lastTimestampRef.current
      const cutoff = now - windowMs

      if (key) {
        const buf = requestBuffersRef.current[key]
        if (!buf) return []
        return buf.toArray().filter((r) => r.end_ms >= cutoff)
      }

      // Return all engines' requests
      const all: InferenceRequestData[] = []
      for (const buf of Object.values(requestBuffersRef.current)) {
        for (const r of buf.toArray()) {
          if (r.end_ms >= cutoff) {
            all.push(r)
          }
        }
      }
      return all
    },
    [version],
  )

  return { getChartData, getSparklineData, getPpChart, getPpGreyChart, getEvents, getRequests }
}
