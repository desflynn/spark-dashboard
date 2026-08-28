import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  connectionStatus: 'connected' as const,
  isStale: true,
  metrics: null,
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
})
