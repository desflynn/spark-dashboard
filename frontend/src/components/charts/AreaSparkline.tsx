import { useId } from 'react'
import { FIVE_MIN_MS, type DataPoint } from '@/lib/fleet'

interface AreaSparklineProps {
  /** The time series to draw. Empty -> renders a blank spacer of `height`. */
  data: DataPoint[]
  /** Stroke/fill color of the area (a design-token color or any CSS color). */
  color: string
  /** Chart height in px. */
  height?: number
  /** Render the trailing-value dot at the right edge (default true). */
  showDot?: boolean
  /** Snapshot timestamp anchoring the fixed five-minute x-axis. */
  nowMs: number
}

// The SVG is drawn in a normalized 100-wide box and stretched with
// `preserveAspectRatio="none"`, so the component can be any width while the
// line math stays resolution-independent.
const VIEW_WIDTH = 100
const MAX_CONTIGUOUS_GAP_MS = 2500

export function AreaSparkline({
  data,
  color,
  height = 40,
  showDot = true,
  nowMs,
}: AreaSparklineProps) {
  const gid = useId()

  if (data.length === 0) {
    return <div className="w-full" style={{ height }} />
  }

  const cutoff = nowMs - FIVE_MIN_MS
  const xs = data.map((point) =>
    Math.max(0, Math.min(VIEW_WIDTH, ((point.timestamp - cutoff) / FIVE_MIN_MS) * VIEW_WIDTH)),
  )
  const values = data.map((d) => d.value)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < 1e-6) {
    // Flat series: nudge the bounds so the line is visible instead of a
    // hairline on the axis.
    hi = lo + 1
    lo = Math.max(0, lo - 1)
  }
  const pad = (hi - lo) * 0.2
  hi += pad
  lo -= pad

  const pts = data.map((d, i) => [
    xs[i],
    height - ((d.value - lo) / (hi - lo)) * height,
  ])

  const segments: typeof pts[] = [[]]
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && data[i].timestamp - data[i - 1].timestamp > MAX_CONTIGUOUS_GAP_MS) {
      segments.push([])
    }
    segments[segments.length - 1].push(pts[i])
  }
  const linePath = (segment: typeof pts) => segment
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`)
    .join(' ')
  const path = segments.map(linePath).join(' ')
  const areaPath = segments.map((segment) => {
    const firstX = segment[0][0].toFixed(2)
    const lastX = segment[segment.length - 1][0].toFixed(2)
    return `${linePath(segment)} L${lastX} ${height} L${firstX} ${height} Z`
  }).join(' ')
  const lastY = pts[pts.length - 1][1]

  return (
    <div
      className="relative w-full"
      style={{ height }}
      aria-hidden="true"
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gid} x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path
          d={areaPath}
          fill={`url(#${gid})`}
          stroke="none"
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.7}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {showDot && (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: `${xs[xs.length - 1]}%`,
            top: `${(lastY / height) * 100}%`,
            width: '6px',
            height: '6px',
            backgroundColor: color,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
    </div>
  )
}
