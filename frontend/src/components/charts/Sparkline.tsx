import React from 'react'
import { LineChart, Line } from 'recharts'
import { NVIDIA_THEME } from '@/lib/theme'

interface SparklineSeries {
  data: number[]
  color?: string
}

interface SparklineProps {
  data?: number[]
  series?: SparklineSeries[]
  color?: string
  width?: number
  height?: number
}

const SPARK_POINTS = 30

function padTo(data: number[], n: number): number[] {
  if (data.length === 0) return data
  if (data.length < n) return [...Array(n - data.length).fill(data[0]), ...data]
  if (data.length > n) return data.slice(-n)
  return data
}

export const Sparkline = React.memo(function Sparkline({
  data,
  series,
  color = NVIDIA_THEME.chartLine,
  width = 64,
  height = 32,
}: SparklineProps) {
  const lines: SparklineSeries[] =
    series ?? (data !== undefined ? [{ data, color }] : [])
  const lineCount = lines.length
  if (lineCount === 0) {
    return <LineChart width={width} height={height} data={[]} />
  }
  // All series share the same x-axis (fixed SPARK_POINTS window); pack each
  // into its own key on the row. Each series is normalized to its own max —
  // a sparkline is an impression, not a shared axis. Scaling Active (0–1)
  // against Total (0–75) on one domain would flatten green onto the floor
  // underneath the other lines.
  const padded = lines.map((l) => padTo(l.data, SPARK_POINTS))
  const rowCount = SPARK_POINTS
  const rows = Array.from({ length: rowCount }, (_, i) => {
    const row: Record<string, number> = { i }
    padded.forEach((p, k) => {
      const max = Math.max(1, ...p)
      row[`v${k}`] = ((p[i] ?? p[p.length - 1] ?? 0) / max) * 100
    })
    return row
  })
  return (
    <LineChart width={width} height={height} data={rows}>
      {lines.map((l, k) => (
        <Line
          key={k}
          type="monotone"
          dataKey={`v${k}`}
          stroke={l.color ?? color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  )
})
