import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dashboard } from '../components/views/Dashboard'
import { engineKey } from '../lib/identity'
import type { EngineSnapshot, GpuMetrics, MetricsSnapshot } from '../types/metrics'

const GIB = 1_073_741_824

function makeGpu(index: number, overrides: Partial<GpuMetrics> = {}): GpuMetrics {
  return {
    index,
    name: `NVIDIA Alpha ${index}`,
    utilization_percent: 11,
    memory_total_bytes: 48 * GIB,
    memory_used_bytes: 24 * GIB,
    temperature_celsius: 40,
    power_watts: 100,
    power_limit_watts: 300,
    clock_graphics_mhz: 1800,
    clock_sm_mhz: 1800,
    clock_memory_mhz: 9000,
    fan_speed_percent: 30,
    ...overrides,
  }
}

function makeSnapshot(gpus?: GpuMetrics[], engines: EngineSnapshot[] = []): MetricsSnapshot {
  const first = gpus?.[0]
  return {
    timestamp_ms: 1000,
    gpu: first ?? makeGpu(0),
    ...(gpus ? { gpus } : {}),
    cpu: { name: 'CPU', aggregate_percent: 25, per_core: [] },
    memory: {
      total_bytes: 128 * GIB,
      display_total_bytes: 128 * GIB,
      used_bytes: 64 * GIB,
      available_bytes: 64 * GIB,
      cached_bytes: 8 * GIB,
      gpu_estimated_bytes: null,
      gpu_memory_total_bytes: null,
      gpu_memory_used_bytes: null,
      is_unified: false,
    },
    disk: { name: 'disk', read_bytes_per_sec: 1, write_bytes_per_sec: 2 },
    network: { name: 'net', rx_bytes_per_sec: 3, tx_bytes_per_sec: 4 },
    engines,
    gpu_events: [],
  }
}

function makeEngine(endpoint: string, name: string): EngineSnapshot {
  return {
    engine_type: 'Vllm',
    endpoint,
    status: { type: 'Running' },
    model: {
      name,
      parameter_size: '27.8B',
      precision: 'BF16',
      quantization: 'NVFP4',
      tensor_type: 'compressed-tensors',
      model_type: null,
      pipeline_tag: null,
    },
    metrics: {
      tokens_per_sec: 24,
      avg_tokens_per_sec: 24,
      per_request_tps: 27,
      ttft_ms: 800,
      active_requests: 2,
      queued_requests: 0,
      kv_cache_percent: 31,
      kv_cache_is_estimated: false,
      total_requests: 412,
      e2e_latency_ms: 4620,
      prompt_tokens_per_sec: 41000,
      avg_prompt_tokens_per_sec: 41000,
      per_request_prompt_tps: 3180,
      swapped_requests: 0,
      prefix_cache_hit_rate: 64,
      queue_time_ms: 12,
      inter_token_latency_ms: 42,
      preemptions_total: 0,
      total_prompt_tokens: 6_100_000,
      total_generation_tokens: 486_200,
      prefix_cache_queries_total: 5_200_000,
      avg_batch_size: 22,
      ttft_percentiles: null,
      itl_percentiles: null,
      e2e_percentiles: null,
      ttft_goodput_pct: 61,
      itl_goodput_pct: 78,
      e2e_goodput_pct: 71,
      tpot_ms: 17,
      tpot_percentiles: null,
      tpot_goodput_pct: 96,
      ttft_buckets: null,
      itl_buckets: null,
      e2e_buckets: null,
      tpot_buckets: null,
      spec_decode_draft_tokens_total: 369_100,
      spec_decode_accepted_tokens_total: 214_000,
      spec_decode_drafts_total: 100_000,
      spec_decode_acceptance_rate: 58,
      spec_decode_acceptance_rate_live: 58,
      spec_decode_mean_acceptance_length: 3.41,
    },
    recent_requests: [],
    deployment_mode: 'Docker',
    gpu_indexes: [],
  }
}

function stubHistory() {
  const calls: string[] = []
  return {
    calls,
    getChartData: (metric: string) => {
      calls.push(metric)
      return []
    },
  }
}

describe('Fleet Dashboard', () => {
  it('survives the metrics null → first-snapshot transition (initial WebSocket connect)', () => {
    const history = stubHistory()
    const spy = vi.fn()
    const { rerender } = render(
      <Dashboard metrics={null} history={history} events={[]} requests={[]} activeTab="all" onActiveTabChange={spy} />,
    )

    expect(() =>
      rerender(
        <Dashboard
          metrics={makeSnapshot([makeGpu(0)], [makeEngine('http://localhost:8000', 'model-a'), makeEngine('http://localhost:8001', 'model-b')])}
          history={history}
          events={[]}
          requests={[]}
          activeTab="all"
          onActiveTabChange={spy}
        />,
      ),
    ).not.toThrow()
  })

  it('renders one per-model row per engine on the All tab; clicking a row switches tabs', async () => {
    const user = userEvent.setup()
    const engineA = makeEngine('http://localhost:8000', 'test-model-a')
    const engineB = makeEngine('http://localhost:8001', 'test-model-b')
    const onActiveTabChange = vi.fn()
    const onActiveEngineChange = vi.fn()
    const snapshot = makeSnapshot([makeGpu(0)], [engineA, engineB])
    const { rerender } = render(
      <Dashboard
        metrics={snapshot}
        history={stubHistory()}
        events={[]}
        requests={[]}
        activeTab="all"
        onActiveTabChange={onActiveTabChange}
        onActiveEngineChange={onActiveEngineChange}
      />,
    )

    expect(screen.getByRole('button', { name: /test-model-a/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /test-model-b/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /test-model-b/ }))
    expect(onActiveTabChange).toHaveBeenCalledWith(engineKey(engineB))

    // App owns the tab state: re-render with the selection applied, and the log
    // viewer follows — model tab reports its endpoint.
    rerender(
      <Dashboard
        metrics={snapshot}
        history={stubHistory()}
        events={[]}
        requests={[]}
        activeTab={engineKey(engineB)}
        onActiveTabChange={onActiveTabChange}
        onActiveEngineChange={onActiveEngineChange}
      />,
    )
    expect(onActiveEngineChange).toHaveBeenCalledWith('http://localhost:8001')
  })

  it('reports undefined to the log viewer on the All tab', () => {
    const onActiveEngineChange = vi.fn()
    render(
      <Dashboard
        metrics={makeSnapshot([makeGpu(0)], [makeEngine('http://localhost:8000', 'test-model-a')])}
        history={stubHistory()}
        events={[]}
        requests={[]}
        activeTab="all"
        onActiveTabChange={vi.fn()}
        onActiveEngineChange={onActiveEngineChange}
      />,
    )
    expect(onActiveEngineChange).toHaveBeenCalledWith(undefined)
  })

  it('reads per-GPU history keys on multi-GPU hosts and plain keys on single-GPU hosts', () => {
    const gpus = [makeGpu(0), makeGpu(1)]
    const engines = [makeEngine('http://localhost:8000', 'test-model-a')]

    const multi = stubHistory()
    render(
      <Dashboard metrics={makeSnapshot(gpus, engines)} history={multi} events={[]} requests={[]} activeTab="all" onActiveTabChange={vi.fn()} />,
    )
    expect(multi.calls).toContain('gpu:0:gpuUtil')
    expect(multi.calls).toContain('cpuAggregate')

    const single = stubHistory()
    render(
      <Dashboard metrics={makeSnapshot([makeGpu(0)], engines)} history={single} events={[]} requests={[]} activeTab="all" onActiveTabChange={vi.fn()} />,
    )
    expect(single.calls).toContain('gpuUtil')
    expect(single.calls.filter((c) => c.startsWith('gpu:'))).toEqual([])
  })
})
