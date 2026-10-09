# Spark Dashboard Fleet Redesign — Implementation Spec

You are implementing ONE half of a two-agent frontend redesign of spark-dashboard.
Your file ownership is stated at the bottom. The other agent owns everything else —
touch ONLY your files. Do NOT run npm/cargo builds (the integrator does that).
Do NOT modify any file you do not own. Do NOT touch Rust code, package.json,
vite.config.ts, or any lib/ hook/ type file outside your ownership list.

## Context

Repo root: `/Users/des/dev/dgx-spark-lab/spark-dashboard` (frontend in `frontend/`).
Rust backend streams a `MetricsSnapshot` over WebSocket to a React 19 + Vite +
Tailwind 4 frontend. We are replacing the main dashboard view with a new
"fleet" layout to match a design concept. **No backend changes.** Every field
the concept needs already exists in the wire types.

Visual source of truth (READ IT — it is a complete annotated mock):
`/Users/des/dev/dgx-spark-lab/evidence/spark-redesign-unpacked/Spark Dashboard.dc.html`
(ignore its `{{ }}` bindings and `support.js` — those are mock data; keep only
the layout, styling, and information design).

## Design tokens (use exactly)

- Page bg `#08090a` · card bg `#101214` · inner row bg `#141719` · border `#1d2226`
- Text primary `#e7eaed` · secondary `#8b949d` · muted `#525a61` · faint `#3f464c`
- Labels: `10px`, weight 600, `letter-spacing .11em`, uppercase, color `#6d767e`
- Big numbers: IBM Plex Mono, weight 600, `letter-spacing -0.02em` (huge ones `-0.045em`)
- Colors: GOOD `oklch(0.80 0.18 140)` (green) · COOL `oklch(0.78 0.13 225)` (blue)
  · WARN `oklch(0.80 0.16 78)` (amber) · CRIT `oklch(0.66 0.20 27)` (red)
- Cards: `border 1px solid #1d2226`, `border-radius 16px`, `padding clamp(16px,1.4vw,22px)`
- Section gap: `clamp(10px,1vw,14px)`; page `max-width 1900px` centered, `padding clamp(12px,1.6vw,26px)`
- Live dot: 8px green circle, `sd-pulse` 2.6s ease-in-out opacity keyframe
- Fonts: IBM Plex Sans (body) + IBM Plex Mono (numbers) — the integrator swaps
  index.css/index.html to load these; just reference `'IBM Plex Mono', monospace`
  and let body font fall through.

## Data sources (ALL exist already — wire types in `frontend/src/types/metrics.ts`)

- `MetricsSnapshot { gpu, gpus?, cpu, memory, disk, network, engines: EngineSnapshot[], gpu_events }`
- Per engine `engine.metrics: EngineMetrics`:
  - PP: `prompt_tokens_per_sec` (live), `avg_prompt_tokens_per_sec`, `per_request_prompt_tps`, `total_prompt_tokens`
  - TG: `tokens_per_sec` (live), `avg_tokens_per_sec`, `per_request_tps`, `total_generation_tokens`
  - Latency: `ttft_ms`, `inter_token_latency_ms`, `tpot_ms`, `e2e_latency_ms`, `avg_batch_size`
  - SLO goodput %: `ttft_goodput_pct`, `itl_goodput_pct`, `tpot_goodput_pct`, `e2e_goodput_pct`
  - Requests: `active_requests`, `queued_requests`, `total_requests`
  - Cache: `prefix_cache_hit_rate` (%), `kv_cache_percent` (%), `prefix_cache_queries_total`
  - Spec decode (all nullable — hide section when all null): `spec_decode_acceptance_rate`,
    `spec_decode_mean_acceptance_length`, `spec_decode_accepted_tokens_total`, `spec_decode_draft_tokens_total`
- `engine.model: ModelInfo | null { name, parameter_size, quantization, precision, tensor_type, model_type, pipeline_tag }`
- `engine.endpoint` — unique per engine; `engineKey(engine)` from `lib/identity.ts` is the history/tab key.
- Hardware: `cpu { name, aggregate_percent, per_core: CoreMetrics[] }`,
  `memory { display_total_bytes?, total_bytes, used_bytes, available_bytes, cached_bytes, gpu_estimated_bytes }`,
  `disk { read_bytes_per_sec, write_bytes_per_sec }`, `network { rx_bytes_per_sec, tx_bytes_per_sec }`,
  GPU via `snapshotGpus(metrics)` + `gpuIndexOf` + `findGpuByIndex` from `lib/identity.ts`.

### History API (prop `history` passed to Dashboard)

```ts
getChartData(metric: string): Array<{ timestamp: number; value: number }>
```
System keys: `gpuUtil, gpuTemp, gpuPower, gpuClockGraphics, cpuAggregate,
diskRead, diskWrite, networkRx, networkTx` (multi-GPU: `gpu:<idx>:<metric>`).
Engine keys: `engine:<engineKey>:<series>` where series ∈
`tps, avgTps, perReqTps, promptTps, avgPromptTps, perReqPromptTps, ttft, kvCache,
prefixCacheHit, e2eLatency, queueTime, interTokenLatency, batchSize, tpot,
activeRequests, queuedRequests, totalRequests` (+ P50/P95/P99 variants).
Buffer: 1 sample/sec, 15-min capacity.
**"5-min average" big numbers = mean of points with timestamp ≥ now−300000.**
For the "All" tab, sum per-engine series by timestamp first (pattern: see
`sumSeries` in current `Dashboard.tsx`), then average.

## The layout (top → bottom) — from the mock

1. **Header strip** (owned by the OTHER agent — `App.tsx`; you receive
   `activeTab: 'all' | <engineKey>` as a prop, see contract below)
2. **Summary row** — one card split into 4 cells (hairline `gap:1px` +
   `#1d2226` borders), each: label / big number + unit / status line:
   - Memory free: `available_bytes` GB of `display_total_bytes` GB; status
     `<8 GB` CRIT "Critical — no headroom", `<24 GB` WARN "Tight — X% headroom"
     (X = free/total %), else GOOD "Comfortable"
   - GPU temp: `temperature_celsius` °C · `power_watts` W; "Nominal, no throttle"
   - Queue: sum `queued_requests` waiting; status line "{sum active} in flight"
   - Served: sum `total_requests` requests; "across both models" (or "this model, this session" on a model tab)
3. **Throughput pair** — two equal cards:
   - "Prompt processing" (PP badge, green) / "Token generation" (TG badge, blue)
   - Huge 5-min-avg number + "tok/s · 5-min average"
   - AreaSparkline (green for PP / blue for TG), 76px tall
   - Footer (border-top): Now (live tps) · Per request (per-request tps) · Total read/written (cumulative, k/M format)
4. **Per model** card (ONLY on the All tab): one row per engine —
   name (mono) + meta line (`parameter_size · quantization · precision · pipeline_tag`, skip nulls),
   then columns: PP (5-min avg fmt), TG, First tok (s, colored: ≤0.5s GOOD / ≤2s WARN / else CRIT),
   Cache hit %, In flight ("active / queued q"), + 44px AreaSparkline of that engine's tps
   (first engine green, rest blue)
5. **Latency card** (2fr) + **Cache card** (1fr):
   - Latency: First token (s, same color scale) · Whole answer (s, ≤5s GOOD / ≤15s WARN / else CRIT)
     · Between tokens (ms) · Per output token (ms + "batch of X per step")
     + 54px ttft sparkline (red if ttft>2000ms else green)
     + "Requests meeting each target" chips: 4 pills (dot + label + %) using the
     goodput fields above; colors: ≥90 GOOD / ≥50 WARN / else CRIT (pill bg = color/0.08, border = color/0.25)
     + a gear button opening SLO settings — reuse `useSloSettings` + `SloSettingsControl`
     (`components/engines/SloSettingsControl.tsx`); on the All tab show defaults read-only,
     on a model tab scope to that engine (`engineKey`, `engine.model?.name`)
   - Cache: 270° ring gauge (reuse `ArcGauge` from `components/gauges/ArcGauge.tsx` —
     props `{ value, label, unit, size, thresholds?, displayValue?, segments? }`) showing
     prefix hit %; right side: Prefix lookups (fmt M), KV cache used % + 4px bar;
     bottom (only if spec-decode fields non-null): TAR % (≥60 GOOD/≥30 WARN/else CRIT),
     tok per draft, "accepted / drafted"
6. **THE BOX divider**: "THE BOX" label + hairline + right-aligned hardware line
   (gpu.name / cpu.name / total GB — compose from data, e.g. "NVIDIA GB10 · Cortex-A725 ×20 · 128 GB unified")
7. **Box row** — three cards:
   - GPU load: ArcGauge util % + 88px AreaSparkline(gpuUtil series) + footer temp/power/clock
   - CPU load: ArcGauge aggregate % + sparkline + per-core heat grid — REUSE `CoreHeatmap`
     (`components/charts/CoreHeatmap.tsx`, prop `{ cores }`), label "Per core" + "busiest core N%" in card header
   - Unified memory: big free GB (colors same as summary) + "X GB in use" + stacked bar —
     REUSE `StackedBar` (`components/StackedBar.tsx`, segments `{ value, total, color, label }`)
     with 4 segments: Weights+KV = `gpu_estimated_bytes` (green), Host = used−gpu (blue),
     Page cache = min(cached, available) (purple `oklch(0.72 0.10 285)`), Reserved =
     max(0, display_total−total) else remaining-to-total (grey `#3a4046`); legend row of
     4 (dot + name + GB); bottom note text: free≥24 → "Room for another concurrent model or a
     longer context window." else "Both models resident (…). A third model or a large context
     burst pushes this box into swap."
8. Console strip at the bottom = existing `LogViewer` (other agent owns it).

## Contract between the two agents

`App.tsx` (agent B) renders the header (tabs + Live badge) and keeps:
`useMetrics`, `useMetricsHistory`, `ConfigurationNotices`, `LogViewer`.
It owns `const [activeTab, setActiveTab] = useState<'all' | string>('all')`
and renders:

```tsx
<Dashboard
  metrics={metrics}
  history={history}
  events={events}
  requests={requests}
  activeTab={activeTab}
  onActiveTabChange={setActiveTab}
  collapseCharts={consoleExpanded}
  onActiveEngineChange={handleActiveEngineChange}
/>
```

`Dashboard` (agent A, `components/views/Dashboard.tsx`) MUST keep exactly this
props interface (rename the old file's contents, same export name `Dashboard`,
same path) and must call `onActiveEngineChange(engine.endpoint | undefined)`
whenever the effective tab is a model tab (undefined on All) — this keeps
LogViewer following the selection. Header tab clicks happen in App; Dashboard
never needs to change the tab itself, but if it renders any clickable
per-model row (make rows clickable → call `onActiveTabChange`), that is allowed.

## Existing utilities to reuse (do not rewrite)

- `lib/identity.ts`: `engineKey`, `engineDisplayName`, `snapshotGpus`, `gpuIndexOf`, `findGpuByIndex`
- `lib/engineAggregate.ts`: `aggregateEngines(engines)` → `AggregateSnapshot` (all sums/weighted
  means you need for the All tab) — use it for live values
- `lib/format.ts`: `formatBytes, formatGiB, formatRate, formatMhz, formatCompactTokens,
  formatDurationMs, fmtInt` …
- `lib/slo.ts`: `DEFAULT_SLO` (500/50/5000/500 ms — the concept's chip targets), `combinedGoodput`
- `hooks/useSloSettings.ts`, `components/engines/SloSettingsControl.tsx`
- `lib/theme.ts`: `NVIDIA_THEME`, `THRESHOLDS`, `thresholdColor`
- `components/gauges/ArcGauge.tsx`, `components/charts/CoreHeatmap.tsx`,
  `components/StackedBar.tsx`, `components/ui/*`
- `components/ConnectionBadge.tsx` (App keeps using it or inlines the Live badge — agent B's call)

## Number formatting (match the mock)

`fmt(n)`: ≥1e6 → "130.1M", ≥1e3 → "4.3k" (drop trailing .0), ≥100 → integer, else 1 decimal.
tok/s live values: same. TTFT big number: seconds with 1 decimal (e.g. "4.3 s").
`formatCompactTokens` in lib/format.ts already does k/M for token totals.

## Constraints

- TypeScript strict: `npm run lint` (eslint) and `tsc -b` must pass on your files.
  You cannot run them — write code that will (exact imports, no unused vars;
  eslint baseline is clean).
- Keep the multi-GPU story: use `snapshotGpus` + the existing `gpu:<idx>:` history
  key pattern for GPU series (mirror what current Dashboard.tsx does).
- If an engine has `metrics: null` (stopped), render its row with "—" values, opacity 40%.
- No new dependencies. No new files outside your ownership list (AreaSparkline is
  the one sanctioned new component for agent A).
- Keep existing vitest tests green — files you don't own are frozen.

## File ownership

**AGENT A — fleet view** (you are reading this; check which list matches your brief):
- REWRITE `frontend/src/components/views/Dashboard.tsx`
- NEW `frontend/src/components/charts/AreaSparkline.tsx`
- NEW `frontend/src/lib/fleet.ts` (helpers: fmt, 5-min mean, sumSeries, color
  thresholds) + NEW `frontend/src/__tests__/fleet.test.ts` (vitest, unit project)

**AGENT B — shell**:
- `frontend/src/App.tsx` (concept header: pulsing dot, "SPARK" + subline,
  All/model tab chips, Live badge from connectionStatus; header tab list from
  `metrics.engines`; keep ConfigurationNotices + LogViewer + main structure)
- `frontend/index.html` + `frontend/src/index.css` (swap Inter/JetBrains Mono →
  IBM Plex Sans/IBM Plex Mono, keep @import tailwind + shadcn imports, update
  `--font-sans`/`--font-mono` theme vars; keep the Google-Fonts link pattern)
- `frontend/src/components/LogViewer.tsx` (concept console strip: caret +
  "Console" + scope on the left, disk "R r · W w" + net "rx · tx" on the right
  of the collapsed header row — accept new optional props
  `disk?: { read: number; write: number }` `network?: { rx: number; tx: number }`
  (bytes/sec, format with `formatRate`); keep expand behavior + engine selection)

If your brief names AGENT A files, do A. If AGENT B, do B.
