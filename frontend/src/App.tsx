import { useMemo, useState } from 'react'
import { useDashboardConfiguration } from './hooks/useDashboardConfiguration'
import { useMetrics } from './hooks/useMetrics'
import { useMetricsHistory } from './hooks/useMetricsHistory'
import { ConfigurationNotices } from './components/ConfigurationNotices'
import { Dashboard } from './components/views/Dashboard'
import { LogViewer } from './components/LogViewer'
import { engineKey, findEngineByKey } from './lib/identity'
import type { EngineSnapshot } from './types/metrics'
import type { GpuEvent, InferenceRequest } from './types/events'

/** Strip the "organization/" prefix from a HuggingFace-style model id so only
 *  the model name shows (e.g. "Qwen/Qwen2.5-7B-Instruct" -> "Qwen2.5-7B-Instruct"). */
function modelBaseName(name: string): string {
  const slash = name.lastIndexOf('/')
  return slash >= 0 ? name.slice(slash + 1) : name
}

/** Pull ":port" from an endpoint URL — the fallback label when an engine has
 *  no model of its own. Mirrors the engine-tab shortening. */
function portFallback(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return url.port ? `:${url.port}` : ''
  } catch {
    const match = endpoint.match(/:(\d+)(?:\/|$)/)
    return match ? `:${match[1]}` : ''
  }
}

/** Label for a model tab chip: the model's short name, or its endpoint port
 *  when the engine has no model. */
function chipLabel(engine: EngineSnapshot): string {
  const name = engine.model?.name
  if (name) return modelBaseName(name)
  return portFallback(engine.endpoint) || engine.endpoint
}

/** Left-hand subline under the SPARK wordmark. */
function sublineLabel(engines: EngineSnapshot[], activeTab: string): string {
  if (activeTab === 'all') return `FLEET · ${engines.length} MODELS ON ONE BOX`
  const engine = findEngineByKey(engines, activeTab)
  return engine ? chipLabel(engine) : activeTab
}

/** Styling for one tab chip. Model chips use mono type; the "All" chip is
 *  sans. Active swaps the fill/background; weight stays put (All = 600, models
 *  = 500) so the selected chip reads only as a colour change, not a reweight. */
function chipClasses(active: boolean, mono: boolean): string {
  return [
    'text-[12.5px]',
    mono ? 'font-medium font-mono' : 'font-semibold',
    'rounded-[7px] px-[13px] py-[7px] transition-colors',
    active
      ? 'bg-[oklch(0.80_0.18_140)] text-[#08090a]'
      : 'text-[#8b949d] hover:text-[#e7eaed]',
  ].join(' ')
}

function App() {
  const { metrics, connectionStatus, isStale } = useMetrics()
  // The configuration is loaded and saved from here, at the root, because it is
  // one document for the whole dashboard. Nothing renders from it yet — the
  // panel grid that will is #79 — but the operator is told now when it could not
  // be loaded or cannot be saved, rather than after a layout silently reverts.
  const { notices: configurationNotices } = useDashboardConfiguration()
  const [consoleExpanded, setConsoleExpanded] = useState(false)

  // The active fleet tab. 'all' = both models; otherwise an engine key. The
  // header owns tab state — Dashboard is controlled by it and never flips the
  // tab itself (it can only open model tabs via onActiveTabChange).
  const [activeTab, setActiveTab] = useState<'all' | string>('all')

  // Engine the console streams: follows the active tab, undefined on All.
  // Derived (not stored) so the header and the log viewer can never disagree.
  const engines = metrics?.engines ?? []
  const selectedEngineEndpoint =
    activeTab === 'all' ? undefined : findEngineByKey(engines, activeTab)?.endpoint

  const history = useMetricsHistory(metrics)

  const { getEvents, getRequests } = history

  const events = useMemo((): GpuEvent[] =>
    getEvents().map((e) => ({
      timestamp_ms: e.timestamp_ms,
      gpu_index: e.gpu_index,
      event_type: e.event_type as GpuEvent['event_type'],
      detail: e.detail,
    })),
    [getEvents],
  )

  const requests = useMemo((): InferenceRequest[] =>
    getRequests().map((r) => ({
      start_ms: r.start_ms,
      end_ms: r.end_ms,
      tps: r.tokens_per_sec,
      ttft_ms: r.ttft_ms,
    })),
    [getRequests],
  )

  const liveConnected = connectionStatus === 'connected'

  return (
    <div className="h-dvh flex flex-col bg-[#08080a] overflow-hidden">
      <header className="shrink-0 border-b border-[#1d2226] px-4 py-3 flex justify-between items-center gap-4">
        <div className="flex items-center gap-[11px]">
          <span
            className="inline-block w-2 h-2 rounded-full bg-[oklch(0.80_0.18_140)] sd-pulse"
            aria-hidden="true"
          />
          <h1 className="text-[12.5px] font-semibold uppercase tracking-[0.16em] text-[#e7eaed]">
            SPARK
          </h1>
          <span className="text-[12.5px] uppercase tracking-[0.16em] text-[#78828c]">
            {sublineLabel(engines, activeTab)}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Segmented tab group. Active chip = green fill / dark text; model
            * chips are mono, the "All" chip is sans. */}
          <div className="inline-flex items-center gap-[2px] flex-wrap rounded-[10px] bg-[#101214] border border-[#1d2226] p-[3px]">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`${chipClasses(activeTab === 'all', false)} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.80_0.18_140)]`}
            >
              All · {engines.length}
            </button>
            {engines.map((engine) => {
              const key = engineKey(engine)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`${chipClasses(activeTab === key, true)} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.80_0.18_140)]`}
                >
                  {chipLabel(engine)}
                </button>
              )
            })}
          </div>

          {/* Live / Paused indicator — plain, driven by connectionStatus. */}
          <span
            className="inline-flex items-center gap-[7px] rounded-[10px] bg-[#101214] border border-[#1d2226] px-3 py-2 select-none"
            role="status"
            aria-live="polite"
          >
            <span
              className={`inline-block w-[7px] h-[7px] rounded-full ${
                liveConnected ? 'bg-[oklch(0.80_0.18_140)]' : 'bg-[#78828c]'
              }`}
              aria-hidden="true"
            />
            <span className="text-[12px] font-medium text-[#8b949d]">
              {liveConnected ? 'Live' : 'Paused'}
            </span>
          </span>
        </div>
      </header>

      <ConfigurationNotices notices={configurationNotices} />

      <main className={`flex-1 overflow-y-auto flex flex-col p-3 lg:p-4 2xl:p-5 min-[1920px]:p-6 ${isStale ? 'opacity-50' : ''}`}>
        {!metrics && connectionStatus !== 'connected' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-bold text-zinc-50 mb-2">Waiting for metrics</h2>
              <p className="text-zinc-400">
                Connecting to the metrics server at {window.location.origin}. Make sure spark-dashboard is running.
              </p>
            </div>
          </div>
        )}

        <Dashboard
          metrics={metrics}
          history={history}
          events={events}
          requests={requests}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          collapseCharts={consoleExpanded}
          // Selection follows the active tab (derived above), so this is a
          // placeholder that satisfies the Dashboard props contract.
          onActiveEngineChange={() => { /* tab owns selection; see above */ }}
        />

        <LogViewer
          engines={engines}
          selectedEndpoint={selectedEngineEndpoint}
          onExpandChange={setConsoleExpanded}
          disk={
            metrics?.disk
              ? { read: metrics.disk.read_bytes_per_sec, write: metrics.disk.write_bytes_per_sec }
              : undefined
          }
          network={
            metrics?.network
              ? { rx: metrics.network.rx_bytes_per_sec, tx: metrics.network.tx_bytes_per_sec }
              : undefined
          }
        />
      </main>
    </div>
  )
}

export default App
