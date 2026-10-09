import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AreaSparkline } from '@/components/charts/AreaSparkline'
import { FIVE_MIN_MS } from '@/lib/fleet'

describe('AreaSparkline time axis', () => {
  it('positions samples by timestamp across a fixed five-minute window', () => {
    const now = 1_000_000
    const { container } = render(
      <AreaSparkline
        data={[
          { timestamp: now - FIVE_MIN_MS, value: 10 },
          { timestamp: now - 10_000, value: 20 },
        ]}
        color="blue"
        nowMs={now}
      />,
    )

    const line = container.querySelectorAll('path')[1]
    expect(line.getAttribute('d')).toMatch(/^M0\.00 /)
    expect(line.getAttribute('d')).toContain('96.67')
  })

  it('keeps a short recent burst short instead of stretching it across the chart', () => {
    const now = 1_000_000
    const { container } = render(
      <AreaSparkline
        data={[
          { timestamp: now - 10_000, value: 10 },
          { timestamp: now, value: 20 },
        ]}
        color="blue"
        nowMs={now}
      />,
    )

    const line = container.querySelectorAll('path')[1]
    expect(line.getAttribute('d')).toMatch(/^M96\.67 /)
    expect(line.getAttribute('d')).toContain('100.00')
  })

  it('does not smooth beyond the measured range', () => {
    const now = 1_000_000
    const { container } = render(
      <AreaSparkline
        data={[
          { timestamp: now - 2_000, value: 0 },
          { timestamp: now - 1_000, value: 100 },
          { timestamp: now, value: 0 },
        ]}
        color="blue"
        nowMs={now}
      />,
    )

    expect(container.querySelectorAll('path')[1].getAttribute('d')).not.toContain('C')
  })

  it('breaks the line across an unmeasured gap', () => {
    const now = 1_000_000
    const { container } = render(
      <AreaSparkline
        data={[
          { timestamp: now - 20_000, value: 10 },
          { timestamp: now - 19_000, value: 20 },
          { timestamp: now - 1_000, value: 30 },
          { timestamp: now, value: 40 },
        ]}
        color="blue"
        nowMs={now}
      />,
    )

    expect(container.querySelectorAll('path')[1].getAttribute('d')?.match(/M/g)).toHaveLength(2)
  })
})
