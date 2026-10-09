import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MetricsSnapshot } from '@/types/metrics'

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

describe('App live status', () => {
  it('does not claim Live when the connected metrics feed is stale', () => {
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Paused')
  })

  it('preserves deployed names and order without changing engine identities', () => {
    const engines = [
      { engine_type: 'Vllm', endpoint: 'http://localhost:18314', model: { name: 'checkpoint-c' } },
      { engine_type: 'Vllm', endpoint: 'http://localhost:18300', model: { name: 'checkpoint-q' } },
      { engine_type: 'Vllm', endpoint: 'http://localhost:18312', model: { name: 'checkpoint-o' } },
    ] as unknown as MetricsSnapshot['engines']
    state.metrics = { engines } as MetricsSnapshot
    render(<App />)
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels).toEqual(['All · 3', 'Qwen 3.8 0Z2', 'Ornith', 'Decider'])
    expect(engines.map((engine) => engine.endpoint)).toEqual([
      'http://localhost:18314', 'http://localhost:18300', 'http://localhost:18312',
    ])
    expect(engines[1].model?.name).toBe('checkpoint-q')
  })
})
