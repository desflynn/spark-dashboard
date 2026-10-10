import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineSnapshot, MetricsSnapshot } from '@/types/metrics'

const state = vi.hoisted(() => ({
  connectionStatus: 'connected' as const,
  isStale: true,
  metrics: null as MetricsSnapshot | null,
}))

vi.mock('@/hooks/useMetrics', () => ({ useMetrics: () => state }))
vi.mock('@/hooks/useDashboardConfiguration', () => ({
  useDashboardConfiguration: () => ({ notices: [] }),
}))
vi.mock('@/hooks/useMetricsHistory', () => ({
  useMetricsHistory: () => ({
    getChartData: () => [],
    getSparklineData: () => [],
    getEvents: () => [],
    getRequests: () => [],
  }),
}))
vi.mock('@/components/views/Dashboard', () => ({ Dashboard: () => null }))
vi.mock('@/components/LogViewer', () => ({ LogViewer: () => null }))

import App from '@/App'

function engine(port: number, name: string | null): EngineSnapshot {
  return {
    engine_type: 'Vllm',
    endpoint: `http://localhost:${port}`,
    status: { type: 'Running' },
    model: name === null ? null : {
      name, parameter_size: null, quantization: null, precision: null,
      tensor_type: null, model_type: null, pipeline_tag: null,
    },
    metrics: null,
    recent_requests: [],
    deployment_mode: 'Docker',
    sampled_at_ms: null,
  }
}

describe('App live status', () => {
  beforeEach(() => {
    state.metrics = null
  })

  it('does not claim Live when the connected metrics feed is stale', () => {
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Paused')
  })

  it('shows the deployed engines in display order without changing their identities', () => {
    const engines = [
      engine(18316, '/checkpoint'),
      engine(18312, '/checkpoint'),
      engine(18314, null),
      engine(18300, '/home/des/scratch/seat0u-model'),
    ]
    state.metrics = { engines } as MetricsSnapshot
    render(<App />)
    const header = screen.getByRole('banner')
    expect(within(header).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'All · 4', 'Qwen 3.8 0Z2', 'Qwen 3.8 27B', 'Ornith', 'Decider',
    ])
    for (const name of ['Qwen 3.8 0Z2', 'Qwen 3.8 27B', 'Ornith', 'Decider']) {
      fireEvent.click(within(header).getByRole('button', { name }))
      expect(within(header).getAllByText(name)).toHaveLength(2)
    }
    expect(engines.map((engine) => engine.endpoint)).toEqual([
      'http://localhost:18316', 'http://localhost:18312', 'http://localhost:18314', 'http://localhost:18300',
    ])
    expect(engines.map((engine) => engine.model?.name ?? null)).toEqual([
      '/checkpoint', '/checkpoint', null, '/home/des/scratch/seat0u-model',
    ])
  })

  it('retains the existing name and port fallbacks for other endpoints', () => {
    state.metrics = { engines: [engine(8000, 'Qwen/Other'), engine(8001, null)] } as MetricsSnapshot
    render(<App />)
    expect(within(screen.getByRole('banner')).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'All · 2', 'Other', ':8001',
    ])
  })
})
