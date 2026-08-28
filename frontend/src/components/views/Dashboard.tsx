import { useEffect } from 'react'
import { ArcGauge } from '@/components/gauges/ArcGauge'
import { CoreHeatmap } from '@/components/charts/CoreHeatmap'
import { StackedBar, type BarSegment } from '@/components/StackedBar'
import { SloSettingsControl } from '@/components/engines/SloSettingsControl'
import { AreaSparkline } from '@/components/charts/AreaSparkline'
import { aggregateEngines } from '@/lib/engineAggregate'
import { engineKey, findEngineByKey, gpuIndexOf, snapshotGpus } from '@/lib/identity'
import { formatCompactTokens, formatGiB, formatMhz, fmtInt } from '@/lib/format'
import { THRESHOLDS } from '@/lib/theme'
import { useSloSettings } from '@/hooks/useSloSettings'
import {
  COOL,
  GOOD,
  alpha,
  activeFleetWindowMean,
  activeWindowMean,
  fmt,
  fmtOptional,
  fmtSeconds,
  firstTokColor,
  gpuTempColor,
  goodputColor,
  memFreeColor,
  memoryBreakdown,
  queueColor,
  sumConcurrentSeries,
  tarColor,
  wholeAnswerColor,
  weightedSeries,
  type DataPoint,
} from '@/lib/fleet'
import type { MetricsSnapshot } from '@/types/metrics'
import type { GpuEvent, InferenceRequest } from '@/types/events'

/** Props mirror the App-provided contract exactly: App owns the header tabs and
 *  owns the `activeTab` state, reporting selection back through
 *  `onActiveTabChange`. `onActiveEngineChange` keeps the log viewer scoped to the
 *  selected model (undefined = the All tab). */
interface DashboardProps {
  metrics: MetricsSnapshot | null
  history: {
    getChartData: (metric: string) => DataPoint[]
  }
  events: GpuEvent[]
  requests: InferenceRequest[]
  activeTab: 'all' | string
  onActiveTabChange: (tab: 'all' | string) => void
  collapseCharts?: boolean
  onActiveEngineChange?: (endpoint: string | undefined) => void
}

/** One cell of the summary row. */
function SummaryCell({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-[3px]" style={{ padding: '13px 17px' }}>
      <div
        className="uppercase"
        style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

/** A label/value pair inside a card footer (Now / Per request / Total, etc.). */
function Foot({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[88px]">
      <div
        className="uppercase"
        style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
      >
        {label}
      </div>
      <div
        className="font-mono tabular-nums"
        style={{ fontSize: '16px', fontWeight: 500, color: '#e7eaed' }}
      >
        {value}
      </div>
    </div>
  )
}

interface ThroughputProps {
  badge: string
  badgeColor: string
  title: string
  sub: string
  big: string
  now: string
  perReq: string
  total: string
  series: DataPoint[]
  color: string
  height: number
  nowMs: number
}

function ThroughputCard({
  badge,
  badgeColor,
  title,
  sub,
  big,
  now,
  perReq,
  total,
  series,
  color,
  height,
  nowMs,
}: ThroughputProps) {
  return (
    <div
      className="flex flex-col min-w-0 min-h-0"
      style={{
        background: '#101214',
        border: '1px solid #1d2226',
        borderRadius: '16px',
        padding: 'clamp(18px, 1.6vw, 26px)',
        gap: '16px',
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block shrink-0"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '11px',
              fontWeight: 600,
              color: badgeColor,
              background: alpha(badgeColor, 0.13),
              borderRadius: '5px',
              padding: '3px 7px',
            }}
          >
            {badge}
          </span>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{title}</span>
        </div>
        <span style={{ fontSize: '11.5px', color: '#78828c' }}>{sub}</span>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <span
          className="font-mono tabular-nums shrink-0"
          style={{
            fontSize: 'clamp(54px, 7vw, 104px)',
            fontWeight: 600,
            letterSpacing: '-0.045em',
            lineHeight: 0.85,
            color: '#e7eaed',
          }}
        >
          {big}
        </span>
        <div className="flex flex-col gap-0.5 pb-1.5">
          <div style={{ fontSize: '17px', color: '#8b949d' }}>tok/s</div>
          <div style={{ fontSize: '11.5px', color: '#78828c' }}>5-min average</div>
        </div>
      </div>

      <div className="relative" style={{ height, margin: '0 -6px' }}>
        <AreaSparkline data={series} color={color} height={height} nowMs={nowMs} />
      </div>

      <div
        className="flex flex-wrap gap-4"
        style={{ borderTop: '1px solid #1d2226', paddingTop: '14px' }}
      >
        <Foot label="Now" value={`${now} tok/s`} />
        <Foot label="Per request" value={`${perReq} tok/s`} />
        <Foot
          label={badge === 'PP' ? 'Total read' : 'Total written'}
          value={`${total} tok`}
        />
      </div>
    </div>
  )
}

interface ModelRowProps {
  name: string
  meta: string
  pp: string
  tg: string
  ttft: string
  ttftColor: string
  hit: string
  active: string
  queued: string
  series: DataPoint[]
  color: string
  onSelect: () => void
  nowMs: number
}

function ModelRow({
  name,
  meta,
  pp,
  tg,
  ttft,
  ttftColor,
  hit,
  active,
  queued,
  series,
  color,
  onSelect,
  nowMs,
}: ModelRowProps) {
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="flex flex-wrap items-center cursor-pointer min-w-0 min-h-0"
      style={{
        background: '#141719',
        border: '1px solid #1d2226',
        borderRadius: '12px',
        padding: '15px 18px',
        gap: '14px 22px',
      }}
      aria-pressed="false"
    >
      <div className="flex flex-col gap-1.5" style={{ flex: '2 1 210px', minWidth: 0 }}>
        <div
          className="font-mono truncate"
          style={{ fontSize: '14.5px', fontWeight: 500, letterSpacing: '-0.01em', color: '#e7eaed' }}
          title={name}
        >
          {name}
        </div>
        {meta.length > 0 && (
          <div style={{ fontSize: '11.5px', color: '#78828c' }}>{meta}</div>
        )}
      </div>

      <Col label="PP" value={<MonoBig>{pp}</MonoBig>} />
      <Col label="TG" value={<MonoBig>{tg}</MonoBig>} />
      <Col
        label="First tok"
        value={
          <MonoBig>
            <span style={{ color: ttftColor }}>{ttft}</span>
            <span style={{ fontSize: '12px', color: '#8b949d', fontWeight: 400 }}> s</span>
          </MonoBig>
        }
      />
      <Col
        label="Cache hit"
        value={
          <MonoBig>
            <span style={{ color: '#e7eaed' }}>{hit}</span>
            <span style={{ fontSize: '12px', color: '#8b949d', fontWeight: 400 }}> %</span>
          </MonoBig>
        }
      />
      <Col
        label="In flight"
        value={
          <MonoBig>
            <span style={{ color: '#e7eaed', whiteSpace: 'nowrap' }}>
              {active} / {queued}
              <span style={{ fontSize: '12px', color: '#8b949d', fontWeight: 400 }}> q</span>
            </span>
          </MonoBig>
        }
      />
      <div className="flex-1 min-w-0 min-h-0" style={{ height: '44px' }}>
        <AreaSparkline data={series} color={color} height={44} nowMs={nowMs} />
      </div>
    </div>
  )
}

/** Wrapper for the 24px engine-table numbers so they share mono styling. */
function MonoBig({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-mono tabular-nums"
      style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.02em', color: '#e7eaed' }}
    >
      {children}
    </span>
  )
}

/** A column header + value inside the per-model row. */
function Col({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5" style={{ flex: '0 1 96px', minWidth: 0 }}>
      <div
        className="uppercase"
        style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
      >
        {label}
      </div>
      {value}
    </div>
  )
}

/** A colored status pill ("Requests meeting each target"). */
function GoodputChip({
  label,
  pct,
  color,
}: {
  label: string
  pct: number | null
  color: string
}) {
  return (
    <div
      className="flex items-center gap-2 shrink-0"
      style={{
        background: alpha(color, 0.08),
        border: `1px solid ${alpha(color, 0.25)}`,
        borderRadius: '999px',
        padding: '6px 12px 6px 10px',
      }}
    >
      <div
        className="shrink-0"
        style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }}
      />
      <span style={{ fontSize: '12px', color: '#a6aeb5' }}>{label}</span>
      <span className="font-mono tabular-nums" style={{ fontSize: '13px', fontWeight: 600, color }}>
        {pct == null ? '—' : Math.round(pct)}%
      </span>
    </div>
  )
}

const GIB = 1_073_741_824

export function Dashboard({
  metrics,
  history,
  activeTab,
  onActiveTabChange,
  onActiveEngineChange,
}: DashboardProps) {
  // Engines (empty when no snapshot yet). Computed before the early return so
  // the hook below can be called unconditionally.
  const engines = metrics?.engines ?? []

  // The effective engine for the current tab. A stale key (not present) falls
  // back to the All view.
  const activeEngine = findEngineByKey(engines, activeTab)
  const isAll = activeTab === 'all' || activeTab === '' || !activeEngine

  // SLO settings scope to the model tab; read-only defaults on All. Called
  // unconditionally (stable hook position) even when disabled.
  const scopeModel = isAll ? null : activeEngine?.model?.name ?? null
  const slo = useSloSettings(isAll ? '' : engineKey(activeEngine!), scopeModel)

  // Keep the log viewer scoped to the selected model; undefined on All.
  useEffect(() => {
    onActiveEngineChange?.(isAll ? undefined : activeEngine?.endpoint)
  }, [isAll, activeEngine?.endpoint, onActiveEngineChange])

  if (!metrics) return null

  const nowMs = metrics.timestamp_ms
  const gpus = snapshotGpus(metrics)
  const multiGpu = gpus.length > 1
  const boxGpu = gpus[0]
  const boxGpuIndex = gpuIndexOf(boxGpu)
  // Multi-GPU hosts read per-GPU series via the `gpu:<idx>:<metric>` keys the
  // history layer writes; single-GPU hosts use the plain metric keys.
  const gpuMetricKey = (m: string) => (multiGpu ? `gpu:${boxGpuIndex}:${m}` : m)

  const running = engines.filter((e) => e.status.type === 'Running' && e.metrics !== null)
  const aggregate = aggregateEngines(running)

  const readSeries = (key: string): DataPoint[] => history.getChartData(key)
  const activeKey = !isAll && activeEngine ? engineKey(activeEngine) : ''
  const eng = (seriesName: string): DataPoint[] => readSeries(`${activeKey}:${seriesName}`)

  // ---- Throughput (PP / TG): 5-min average from history ----
  const ppMean = isAll
    ? activeFleetWindowMean(running.map((e) => readSeries(`${engineKey(e)}:promptTps`)), nowMs)
    : activeWindowMean(eng('promptTps'), nowMs)
  const tgMean = isAll
    ? activeFleetWindowMean(running.map((e) => readSeries(`${engineKey(e)}:tps`)), nowMs)
    : activeWindowMean(eng('tps'), nowMs)

  // Live (instantaneous) values from the snapshot, aggregated or per-engine.
  const ppNow = isAll
    ? aggregate.prompt_tokens_per_sec
    : activeEngine?.metrics?.prompt_tokens_per_sec
  const tgNow = isAll ? aggregate.tokens_per_sec : activeEngine?.metrics?.tokens_per_sec
  const ppPerReq = isAll
    ? aggregate.per_request_prompt_tps
    : activeEngine?.metrics?.per_request_prompt_tps
  const tgPerReq = isAll
    ? aggregate.per_request_tps
    : activeEngine?.metrics?.per_request_tps
  const ppTotal = isAll
    ? aggregate.total_prompt_tokens
    : activeEngine?.metrics?.total_prompt_tokens
  const tgTotal = isAll
    ? aggregate.total_generation_tokens
    : activeEngine?.metrics?.total_generation_tokens

  const ppSeries = isAll
    ? sumConcurrentSeries(running.map((e) => readSeries(`${engineKey(e)}:promptTps`)))
    : sumConcurrentSeries([eng('promptTps')])
  const tgSeries = isAll
    ? sumConcurrentSeries(running.map((e) => readSeries(`${engineKey(e)}:tps`)))
    : sumConcurrentSeries([eng('tps')])

  const throughput = {
    pp: {
      badge: 'PP',
      badgeColor: GOOD,
      title: 'Prompt processing',
      sub: 'prefill · tokens read',
      big: fmtOptional(ppMean),
      now: fmtOptional(ppNow),
      perReq: fmtOptional(ppPerReq),
      total: ppTotal == null ? '—' : formatCompactTokens(ppTotal),
      series: ppSeries,
      color: GOOD,
    },
    tg: {
      badge: 'TG',
      badgeColor: COOL,
      title: 'Token generation',
      sub: 'decode · tokens written',
      big: fmtOptional(tgMean),
      now: fmtOptional(tgNow),
      perReq: fmtOptional(tgPerReq),
      total: tgTotal == null ? '—' : formatCompactTokens(tgTotal),
      series: tgSeries,
      color: COOL,
    },
  }

  // ---- Summary row ----
  const memoryAvailable = metrics.memory.source_available
  const availBytes = metrics.memory.available_bytes
  const displayTotalBytes = metrics.memory.display_total_bytes ?? metrics.memory.total_bytes
  const freeGB = availBytes / GIB
  const totalGB = displayTotalBytes / GIB
  const memColor = memoryAvailable ? memFreeColor(freeGB) : '#8b949d'
  const memStatus = !memoryAvailable
    ? 'Telemetry unavailable'
    : freeGB < 8
      ? 'Critical — no headroom'
      : freeGB < 24
        ? `Tight — ${Math.round((freeGB / totalGB) * 100)}% headroom`
        : 'Comfortable'

  const gpuTemp = boxGpu.temperature_celsius
  const gpuPower = boxGpu.power_watts
  const gpuStatus = gpuTemp == null
    ? 'Telemetry unavailable'
    : gpuTemp >= 85
      ? 'Hot'
      : gpuTemp >= 70
        ? 'Warm'
        : 'Nominal'

  const queuedSum = isAll
    ? aggregate.queued_requests
    : activeEngine?.metrics?.queued_requests
  const activeSum = isAll
    ? aggregate.active_requests
    : activeEngine?.metrics?.active_requests
  const servedSum = isAll
    ? aggregate.total_requests
    : activeEngine?.metrics?.total_requests

  // ---- Latency (cumulative engine histograms since the warmup baseline) ----
  const ttftMs = isAll
    ? aggregate.ttft_ms
    : activeEngine?.metrics?.ttft_ms
  const e2eMs = isAll
    ? aggregate.e2e_latency_ms
    : activeEngine?.metrics?.e2e_latency_ms
  const itlMs = isAll
    ? aggregate.inter_token_latency_ms
    : activeEngine?.metrics?.inter_token_latency_ms
  const tpotMs = isAll
    ? aggregate.tpot_ms
    : activeEngine?.metrics?.tpot_ms
  const batch = isAll
    ? aggregate.avg_batch_size
    : activeEngine?.metrics?.avg_batch_size

  const goodputSources = isAll
    ? [
        aggregate.ttft_goodput_pct,
        aggregate.itl_goodput_pct,
        aggregate.tpot_goodput_pct,
        aggregate.e2e_goodput_pct,
      ]
    : [
        activeEngine?.metrics?.ttft_goodput_pct,
        activeEngine?.metrics?.itl_goodput_pct,
        activeEngine?.metrics?.tpot_goodput_pct,
        activeEngine?.metrics?.e2e_goodput_pct,
      ]
  const sloLabels = [
    'First token under 0.5 s',
    'Token gaps under 50 ms',
    'Output tokens under 50 ms',
    'Full answer under 5 s',
  ] as const

  // ---- Cache ----
  const prefixHit = isAll
    ? aggregate.prefix_cache_hit_rate
    : activeEngine?.metrics?.prefix_cache_hit_rate
  const kvCache = isAll
    ? aggregate.kv_cache_percent
    : activeEngine?.metrics?.kv_cache_percent
  const prefixQueries = isAll
    ? aggregate.prefix_cache_queries_total
    : activeEngine?.metrics?.prefix_cache_queries_total

  const specTar = isAll
    ? aggregate.spec_decode_acceptance_rate
    : activeEngine?.metrics?.spec_decode_acceptance_rate
  const specAcceptLen = isAll
    ? aggregate.spec_decode_mean_acceptance_length
    : activeEngine?.metrics?.spec_decode_mean_acceptance_length
  const specAccepted = isAll
    ? aggregate.spec_decode_accepted_tokens_total
    : activeEngine?.metrics?.spec_decode_accepted_tokens_total
  const specDraft = isAll
    ? aggregate.spec_decode_draft_tokens_total
    : activeEngine?.metrics?.spec_decode_draft_tokens_total
  const showSpec =
    specTar !== null &&
    specAcceptLen !== null &&
    specAccepted !== null &&
    specDraft !== null

  // ---- Box divider hardware line ----
  const hwParts = [
    boxGpu.name ?? 'GPU',
    metrics.cpu.name ?? 'CPU',
    memoryAvailable ? `${formatGiB(displayTotalBytes)} unified` : 'memory unavailable',
  ].filter((p) => p.length > 0)

  // ---- Unified memory segments ----
  const {
    gpuBytes,
    hostBytes,
    cacheBytes,
    reservedBytes,
    freeBytes,
    inUseBytes,
  } = memoryBreakdown({
    displayTotalBytes,
    kernelTotalBytes: metrics.memory.total_bytes,
    usedBytes: metrics.memory.used_bytes,
    availableBytes: metrics.memory.available_bytes,
    cachedBytes: metrics.memory.cached_bytes,
    gpuEstimatedBytes: metrics.memory.gpu_estimated_bytes,
  })
  const memNote = !memoryAvailable
    ? 'Telemetry unavailable'
    : `${fmt(freeBytes / GIB)} GB kernel-available · ${fmt(reservedBytes / GIB)} GB hardware-reserved.`

  const memorySegments: BarSegment[] = memoryAvailable ? [
    { value: gpuBytes, total: displayTotalBytes, color: GOOD, label: 'GPU processes est.' },
    { value: hostBytes, total: displayTotalBytes, color: COOL, label: 'Host used est.' },
    {
      value: cacheBytes,
      total: displayTotalBytes,
      color: 'oklch(0.72 0.10 285)',
      label: 'Page cache',
    },
    { value: reservedBytes, total: displayTotalBytes, color: '#3a4046', label: 'Reserved' },
  ] : []

  // Per-core busiest % for the CPU card subtitle.
  const coreMax = metrics.cpu.per_core.reduce((m, c) => Math.max(m, c.usage_percent), 0)

  return (
    <div className="flex flex-col min-w-0 gap-[clamp(10px,1vw,14px)]">
      {/* ── Summary row ── */}
      <div
        className="flex flex-wrap"
        style={{
          background: '#1d2226',
          border: '1px solid #1d2226',
          borderRadius: '12px',
          overflow: 'hidden',
          gap: 1,
        }}
      >
        <SummaryCell label="Memory free">
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 'clamp(22px, 2vw, 28px)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: memColor,
              }}
            >
              {memoryAvailable ? fmt(freeGB) : '—'}
            </span>
            <span style={{ fontSize: '12.5px', color: '#8b949d' }}>
              {memoryAvailable ? `GB of ${fmtInt(totalGB)}` : 'GB'}
            </span>
          </div>
          <div style={{ fontSize: '11.5px', color: memColor }}>{memStatus}</div>
        </SummaryCell>

        <SummaryCell label="GPU temp">
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 'clamp(22px, 2vw, 28px)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: gpuTemp == null ? '#8b949d' : gpuTempColor(gpuTemp),
              }}
            >
              {gpuTemp == null ? '—' : fmtInt(gpuTemp)}
            </span>
            <span style={{ fontSize: '12.5px', color: '#8b949d' }}>
              °C · {gpuPower == null ? '—' : fmtInt(gpuPower)} W
            </span>
          </div>
          <div style={{ fontSize: '11.5px', color: '#8b949d' }}>{gpuStatus}</div>
        </SummaryCell>

        <SummaryCell label="Queue">
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 'clamp(22px, 2vw, 28px)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: queuedSum == null ? '#8b949d' : queueColor(queuedSum),
              }}
            >
              {fmtOptional(queuedSum)}
            </span>
            <span style={{ fontSize: '12.5px', color: '#8b949d' }}>waiting</span>
          </div>
          <div style={{ fontSize: '11.5px', color: '#8b949d' }}>{fmtOptional(activeSum)} in flight</div>
        </SummaryCell>

        <SummaryCell label="Served">
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-mono tabular-nums"
              style={{ fontSize: 'clamp(22px, 2vw, 28px)', fontWeight: 600, letterSpacing: '-0.02em' }}
            >
              {fmtOptional(servedSum)}
            </span>
            <span style={{ fontSize: '12.5px', color: '#8b949d' }}>requests</span>
          </div>
          <div style={{ fontSize: '11.5px', color: '#8b949d' }}>
            {isAll ? 'across running engine lifetimes' : 'this engine lifetime'}
          </div>
        </SummaryCell>
      </div>

      {/* ── Throughput pair ── */}
      <div className="flex flex-wrap gap-[clamp(10px,1vw,14px)]">
        <ThroughputCard
          badge={throughput.pp.badge}
          badgeColor={throughput.pp.badgeColor}
          title={throughput.pp.title}
          sub={throughput.pp.sub}
          big={throughput.pp.big}
          now={throughput.pp.now}
          perReq={throughput.pp.perReq}
          total={throughput.pp.total}
          series={throughput.pp.series}
          color={throughput.pp.color}
          height={76}
          nowMs={nowMs}
        />
        <ThroughputCard
          badge={throughput.tg.badge}
          badgeColor={throughput.tg.badgeColor}
          title={throughput.tg.title}
          sub={throughput.tg.sub}
          big={throughput.tg.big}
          now={throughput.tg.now}
          perReq={throughput.tg.perReq}
          total={throughput.tg.total}
          series={throughput.tg.series}
          color={throughput.tg.color}
          height={76}
          nowMs={nowMs}
        />
      </div>

      {/* ── Per model (All tab only) ── */}
      {isAll && (
        <div
          className="flex flex-col min-w-0 min-h-0"
          style={{
            background: '#101214',
            border: '1px solid #1d2226',
            borderRadius: '16px',
            padding: 'clamp(16px, 1.4vw, 22px)',
            gap: '14px',
          }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Per model</span>
            <span style={{ fontSize: '11.5px', color: '#78828c' }}>
               both models share one {boxGpu.name ?? 'GB'} and its {memoryAvailable ? fmtInt(totalGB) : '—'} GB
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {engines.map((engine) => {
              const key = engineKey(engine)
              const stopped = engine.metrics === null
              if (stopped) {
                return (
                  <div
                    key={key}
                    className="flex flex-wrap items-center opacity-40"
                    style={{
                      background: '#141719',
                      border: '1px solid #1d2226',
                      borderRadius: '12px',
                      padding: '15px 18px',
                      gap: '14px 22px',
                    }}
                  >
                    <Col label="PP" value={<MonoBig>—</MonoBig>} />
                    <Col label="TG" value={<MonoBig>—</MonoBig>} />
                    <Col label="First tok" value={<MonoBig>—</MonoBig>} />
                    <Col label="Cache hit" value={<MonoBig>—</MonoBig>} />
                    <Col label="In flight" value={<MonoBig>—</MonoBig>} />
                  </div>
                )
              }
              const metaParts = [
                engine.model?.parameter_size,
                engine.model?.quantization,
                engine.model?.precision,
                engine.model?.pipeline_tag,
              ].filter((p): p is string => p != null && p.length > 0)
              const ppMeanE = activeWindowMean(readSeries(`${key}:promptTps`), nowMs)
              const tgMeanE = activeWindowMean(readSeries(`${key}:tps`), nowMs)
              const ttftE = engine.metrics!.ttft_ms
              return (
                <ModelRow
                  key={key}
                  name={engine.model?.name ?? key}
                  meta={metaParts.join(' · ')}
                  pp={fmtOptional(ppMeanE)}
                  tg={fmtOptional(tgMeanE)}
                  ttft={ttftE == null ? '—' : fmtSeconds(ttftE)}
                  ttftColor={ttftE == null ? '#8b949d' : firstTokColor(ttftE)}
                  hit={fmtInt(engine.metrics!.prefix_cache_hit_rate)}
                  active={fmtInt(engine.metrics!.active_requests)}
                  queued={fmtInt(engine.metrics!.queued_requests)}
                  series={sumConcurrentSeries([readSeries(`${key}:tps`)])}
                  color={engine === engines[0] ? GOOD : COOL}
                  onSelect={() => onActiveTabChange(key)}
                  nowMs={nowMs}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Latency (2fr) + Cache (1fr) ── */}
      <div className="flex flex-wrap gap-[clamp(10px,1vw,14px)]">
        {/* Latency */}
        <div
          className="flex flex-col min-w-0 min-h-0"
          style={{
            flex: '2 1 430px',
            background: '#101214',
            border: '1px solid #1d2226',
            borderRadius: '16px',
            padding: 'clamp(16px, 1.4vw, 22px)',
            gap: '16px',
          }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Latency</span>
            <span style={{ fontSize: '11.5px', color: '#78828c' }}>
              lifetime average · {isAll ? 'weighted across both models' : 'this model'}
            </span>
          </div>

          <div className="flex flex-wrap gap-[18px 30px]">
            <LatCol
              label="First token"
              hint="wait before anything appears"
              value={
                <span style={{ color: ttftMs == null ? '#8b949d' : firstTokColor(ttftMs) }}>
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      fontSize: 'clamp(32px, 3.4vw, 46px)',
                      fontWeight: 600,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                    }}
                  >
                    {ttftMs == null ? '—' : fmtSeconds(ttftMs)}
                  </span>
                  <span style={{ fontSize: '16px', color: '#8b949d', fontWeight: 400 }}> s</span>
                </span>
              }
            />
            <LatCol
              label="Whole answer"
              hint="start to last token"
              value={
                <span style={{ color: e2eMs == null ? '#8b949d' : wholeAnswerColor(e2eMs) }}>
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      fontSize: 'clamp(28px, 2.8vw, 36px)',
                      fontWeight: 600,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                    }}
                  >
                    {e2eMs == null ? '—' : fmtSeconds(e2eMs)}
                  </span>
                  <span style={{ fontSize: '14px', color: '#8b949d', fontWeight: 400 }}> s</span>
                </span>
              }
            />
            <LatCol
              label="Between tokens"
              hint="gap the reader sees"
              value={
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: '22px', fontWeight: 500, lineHeight: 1 }}
                >
                  {itlMs == null ? '—' : fmtInt(itlMs)}
                  <span style={{ fontSize: '12px', color: '#8b949d' }}> ms</span>
                </span>
              }
            />
            <LatCol
              label="Per output token"
              hint={batch == null ? 'batch unavailable' : `batch of ${batch.toFixed(1)} per step`}
              value={
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: '22px', fontWeight: 500, lineHeight: 1 }}
                >
                  {tpotMs == null ? '—' : fmtInt(tpotMs)}
                  <span style={{ fontSize: '12px', color: '#8b949d' }}> ms</span>
                </span>
              }
            />
          </div>

          <div className="relative" style={{ height: '54px', margin: '0 -6px' }}>
            <AreaSparkline
              data={
                isAll
                  ? weightedSeries(running.map((e) => ({
                      values: readSeries(`${engineKey(e)}:ttft`),
                      weights: readSeries(`${engineKey(e)}:ttftObservations`),
                    })))
                  : readSeries(`${activeKey}:ttft`)
              }
              color={ttftMs != null && ttftMs > 2000 ? '#ef4444' : GOOD}
              height={54}
              nowMs={nowMs}
            />
          </div>

          <div
            className="flex flex-col"
            style={{ borderTop: '1px solid #1d2226', paddingTop: '13px', gap: '9px' }}
          >
            <div
              className="uppercase"
              style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
            >
              Requests meeting each target
            </div>
            <div className="flex flex-wrap gap-2">
              {sloLabels.map((label, i) => {
                const pct = goodputSources[i] ?? null
                const color = pct == null ? '#8b949d' : goodputColor(pct)
                return (
                  <GoodputChip
                    key={label}
                    label={label}
                    pct={pct}
                    color={color}
                  />
                )
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <SloSettingsControl
              thresholds={slo.thresholds}
              isCustomized={slo.isCustomized}
              disabled={isAll}
              onChange={slo.setThresholds}
              onReset={slo.reset}
            />
          </div>
        </div>

        {/* Cache */}
        <div
          className="flex flex-col min-w-0 min-h-0"
          style={{
            flex: '1 1 300px',
            background: '#101214',
            border: '1px solid #1d2226',
            borderRadius: '16px',
            padding: 'clamp(16px, 1.4vw, 22px)',
            gap: '16px',
          }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Cache</span>
            <span style={{ fontSize: '11.5px', color: '#78828c' }}>reuse over recompute</span>
          </div>

          <div className="flex items-center gap-[clamp(14px,1.6vw,22px)] flex-wrap">
            <div className="relative shrink-0" style={{ width: '138px', height: '138px' }}>
              <ArcGauge value={prefixHit ?? undefined} label="Prefix hit" unit="%" size={138} hideCenter />
              <div
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{ gap: '1px' }}
              >
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: '38px', fontWeight: 600, letterSpacing: '-0.03em' }}
                >
                  {prefixHit == null ? '—' : fmtInt(prefixHit)}
                  <span style={{ fontSize: '17px', color: '#8b949d' }}>%</span>
                </span>
                <div
                  className="uppercase"
                  style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.1em', color: '#8b949d' }}
                >
                  Prefix hit
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <div
                  className="uppercase"
                  style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
                >
                  Prefix lookups
                </div>
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: '19px', fontWeight: 500, color: '#e7eaed' }}
                >
                  {prefixQueries == null ? '—' : formatCompactTokens(prefixQueries)}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-baseline gap-2">
                  <div
                    className="uppercase"
                    style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
                  >
                    KV cache used
                  </div>
                  <span className="font-mono tabular-nums" style={{ fontSize: '13px', fontWeight: 500 }}>
                    {kvCache == null ? '—' : fmtInt(kvCache)}%
                  </span>
                </div>
                <div className="relative h-1 rounded overflow-hidden" style={{ background: '#20252a' }}>
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${kvCache ?? 0}%`, background: COOL, borderRadius: '2px' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {showSpec && (
            <div
              className="flex flex-col"
              style={{ borderTop: '1px solid #1d2226', paddingTop: '13px', gap: '9px' }}
            >
              <div
                className="uppercase"
                style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
              >
                Speculative decoding
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-0.5">
                  <span
                    className="font-mono tabular-nums"
                    style={{ fontSize: '18px', fontWeight: 500, color: tarColor(specTar ?? 0) }}
                  >
                    {fmtInt(specTar ?? 0)}%
                  </span>
                  <span style={{ fontSize: '11.5px', color: '#78828c' }}>drafts accepted</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono tabular-nums" style={{ fontSize: '18px', fontWeight: 500 }}>
                    {Number(specAcceptLen ?? 0).toFixed(2)}
                  </span>
                  <span style={{ fontSize: '11.5px', color: '#78828c' }}>tok per draft</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono tabular-nums" style={{ fontSize: '18px', fontWeight: 500 }}>
                    {formatCompactTokens(specAccepted ?? 0)}
                    <span style={{ fontSize: '12px', color: '#8b949d' }}>
                      {' / '}
                      {formatCompactTokens(specDraft ?? 0)}
                    </span>
                  </span>
                  <span style={{ fontSize: '11.5px', color: '#78828c' }}>accepted of drafted</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── THE BOX divider ── */}
      <div className="flex items-baseline gap-2.5 px-0.5">
        <span
          className="uppercase"
          style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.13em', color: '#8b949d' }}
        >
          The box
        </span>
        <div className="flex-1 h-0.5" style={{ background: '#1d2226' }} />
        <span className="font-mono shrink-0" style={{ fontSize: '11px', color: '#5b646e' }}>
          {hwParts.join(' · ')}
        </span>
      </div>

      {/* ── Box row ── */}
      <div className="flex flex-wrap gap-[clamp(10px,1vw,14px)]">
        {/* GPU load */}
        <div
          className="flex flex-col min-w-0 min-h-0"
          style={{
            flex: '1 1 320px',
            background: '#101214',
            border: '1px solid #1d2226',
            borderRadius: '16px',
            padding: 'clamp(16px, 1.4vw, 22px)',
            gap: '15px',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span style={{ fontSize: '14px', fontWeight: 600 }}>GPU load</span>
            <span className="font-mono shrink-0" style={{ fontSize: '11px', color: '#5b646e' }}>
              {boxGpu.name ?? 'GB10'}
            </span>
          </div>
          <div className="flex items-center gap-[clamp(12px,1.4vw,20px)] flex-wrap">
            <div className="relative shrink-0" style={{ width: '132px', height: '132px' }}>
              <ArcGauge
                value={boxGpu.utilization_percent ?? undefined}
                label="GPU Util"
                unit="%"
                size={132}
                hideCenter
              />
              <div className="absolute inset-0 flex items-center justify-center" style={{ gap: '1px' }}>
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: 'clamp(34px, 3.2vw, 42px)', fontWeight: 600, letterSpacing: '-0.03em' }}
                >
                  {boxGpu.utilization_percent == null ? '—' : fmtInt(boxGpu.utilization_percent)}
                  <span style={{ fontSize: '17px', color: '#8b949d' }}>%</span>
                </span>
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0" style={{ height: '88px' }}>
              <AreaSparkline data={readSeries(gpuMetricKey('gpuUtil'))} color={GOOD} height={88} nowMs={nowMs} />
            </div>
          </div>
          <div
            className="flex flex-wrap"
            style={{ gap: '12px 22px', borderTop: '1px solid #1d2226', paddingTop: '13px' }}
          >
            <Foot
              label="temp"
              value={
                <>
                  <span style={{ color: gpuTemp == null ? '#8b949d' : gpuTempColor(gpuTemp) }}>
                    {gpuTemp == null ? '—' : fmtInt(gpuTemp)}
                    <span style={{ fontSize: '11px', color: '#8b949d' }}> °C</span>
                  </span>
                </>
              }
            />
            <Foot
              label="power"
              value={
                <>
                  {gpuPower == null ? '—' : fmtInt(gpuPower)}
                  <span style={{ fontSize: '11px', color: '#8b949d' }}> W</span>
                </>
              }
            />
            <Foot
              label="clock"
              value={
                <>
                  {formatMhz(boxGpu.clock_graphics_mhz)}
                </>
              }
            />
          </div>
        </div>

        {/* CPU load */}
        <div
          className="flex flex-col min-w-0 min-h-0"
          style={{
            flex: '1 1 320px',
            background: '#101214',
            border: '1px solid #1d2226',
            borderRadius: '16px',
            padding: 'clamp(16px, 1.4vw, 22px)',
            gap: '15px',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span style={{ fontSize: '14px', fontWeight: 600 }}>CPU load</span>
            <span className="font-mono shrink-0" style={{ fontSize: '11px', color: '#5b646e' }}>
              busiest core {fmtInt(coreMax)}%
            </span>
          </div>
          <div className="flex items-center gap-[clamp(12px,1.4vw,20px)] flex-wrap">
            <div className="relative shrink-0" style={{ width: '132px', height: '132px' }}>
              <ArcGauge
                value={metrics.cpu.aggregate_percent}
                label="CPU Util"
                unit="%"
                thresholds={THRESHOLDS.cpuUsage}
                size={132}
                hideCenter
              />
              <div className="absolute inset-0 flex items-center justify-center" style={{ gap: '1px' }}>
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: 'clamp(34px, 3.2vw, 42px)', fontWeight: 600, letterSpacing: '-0.03em' }}
                >
                  {fmtInt(metrics.cpu.aggregate_percent)}
                  <span style={{ fontSize: '17px', color: '#8b949d' }}>%</span>
                </span>
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0" style={{ height: '88px' }}>
              <AreaSparkline data={readSeries('cpuAggregate')} color={COOL} height={88} nowMs={nowMs} />
            </div>
          </div>
          <div className="flex flex-col" style={{ gap: '8px' }}>
            <div
              className="uppercase"
              style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
            >
              Per core
            </div>
            <CoreHeatmap cores={metrics.cpu.per_core} />
          </div>
        </div>

        {/* Unified memory */}
        <div
          className="flex flex-col min-w-0 min-h-0"
          style={{
            flex: '1.3 1 340px',
            background: '#101214',
            border: '1px solid #1d2226',
            borderRadius: '16px',
            padding: 'clamp(16px, 1.4vw, 22px)',
            gap: '15px',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Unified memory</span>
            <span className="font-mono shrink-0" style={{ fontSize: '11px', color: '#5b646e' }}>
              {memoryAvailable ? fmtInt(totalGB) : '—'} GB shared
            </span>
          </div>

          <div className="flex items-end gap-2.5 flex-wrap">
            <span
              className="font-mono tabular-nums shrink-0"
              style={{
                fontSize: 'clamp(40px, 4.2vw, 58px)',
                fontWeight: 600,
                letterSpacing: '-0.04em',
                lineHeight: 0.9,
                color: memFreeColor(freeBytes / GIB),
              }}
            >
              {memoryAvailable ? fmt(freeBytes / GIB) : '—'}
            </span>
            <div className="flex flex-col gap-0.5 pb-1">
              <div style={{ fontSize: '15px', color: '#8b949d' }}>GB free</div>
              <div style={{ fontSize: '11.5px', color: '#78828c' }}>
                {memoryAvailable ? `${fmt(inUseBytes / GIB)} GB in use` : 'Telemetry unavailable'}
              </div>
            </div>
          </div>

          <StackedBar segments={memorySegments} />

          <div className="flex flex-wrap gap-3">
            {memorySegments.map((seg) => (
              <div key={seg.label} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block shrink-0"
                    style={{ width: '7px', height: '7px', borderRadius: '2px', backgroundColor: seg.color }}
                  />
                  <span style={{ fontSize: '11px', color: '#78828c' }}>{seg.label}</span>
                </div>
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: '17px', fontWeight: 500, color: '#e7eaed' }}
                >
                  {fmt(seg.value / GIB)}
                  <span style={{ fontSize: '11px', color: '#8b949d' }}> GB</span>
                </span>
              </div>
            ))}
          </div>

          <div
            className="text-wrap"
            style={{ borderTop: '1px solid #1d2226', paddingTop: '12px', fontSize: '11.5px', color: '#78828c' }}
          >
            {memNote}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A latency metric block: label, big value, and a hint line. */
function LatCol({
  label,
  hint,
  value,
}: {
  label: string
  hint: string
  value: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1" style={{ flex: '1 1 150px', minWidth: 0 }}>
      <div
        className="uppercase"
        style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.11em', color: '#8b949d' }}
      >
        {label}
      </div>
      {value}
      <div style={{ fontSize: '11.5px', color: '#78828c' }}>{hint}</div>
    </div>
  )
}
