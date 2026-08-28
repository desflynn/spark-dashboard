import { useId } from 'react'
import type { DataPoint } from '@/lib/fleet'

interface AreaSparklineProps {
  /** The time series to draw. Empty -> renders a blank spacer of `height`. */
  data: DataPoint[]
  /** Stroke/fill color of the area (a design-token color or any CSS color). */
  color: string
  /** Chart height in px. */
  height?: number
  /** Render the trailing-value dot at the right edge (default true). */
  showDot?: boolean
}

// The SVG is drawn in a normalized 100-wide box and stretched with
// `preserveAspectRatio="none"`, so the component can be any width while the
// line math stays resolution-independent. A Catmull-Rom -> cubic-bezier
// conversion keeps the curve smooth (no spikes) the way the concept mock does.
const VIEW_WIDTH = 100

export function AreaSparkline({
  data,
  color,
  height = 40,
  showDot = true,
}: AreaSparklineProps) {
  const gid = useId()

  if (data.length === 0) {
    return <div className="w-full" style={{ height }} />
  }

  const n = data.length
  const xs = data.map((_, i) => (i / (n - 1)) * VIEW_WIDTH)
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

  let path = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const pm = pts[i - 2] ?? p0
    const pn = pts[i + 1] ?? p1
    const c1x = p0[0] + (p1[0] - pm[0]) / 6
    const c1y = p0[1] + (p1[1] - pm[1]) / 6
    const c2x = p1[0] - (pn[0] - p0[0]) / 6
    const c2y = p1[1] - (pn[1] - p0[1]) / 6
    path += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)},${c2x.toFixed(2)} ${c2y.toFixed(2)},${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`
  }
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
          d={`${path} L${VIEW_WIDTH} ${height} L0 ${height} Z`}
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
            right: 0,
            top: `${(lastY / height) * 100}%`,
            width: '6px',
            height: '6px',
            backgroundColor: color,
            transform: 'translate(50%, -50%)',
          }}
        />
      )}
    </div>
  )
}
