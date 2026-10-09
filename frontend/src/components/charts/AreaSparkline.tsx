import { useId } from 'react'
import { FIVE_MIN_MS, type DataPoint } from '@/lib/fleet'

interface AreaSparklineProps {
  /** The time series to draw. Empty -> renders a blank spacer of `height`. */
  data: DataPoint[]
  /** Dimmer series drawn behind `data` on the same scale (e.g. grey
   *  "working" placeholders while the real value is still unknown). */
  underlay?: DataPoint[]
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
const UNDERLAY_COLOR = '#5a636d'

export function AreaSparkline({
  data,
  underlay,
  color,
  height = 40,
  showDot = true,
  nowMs,
}: AreaSparklineProps) {
  const gid = useId()
  const greyGid = useId()

  const under = underlay ?? []
  if (data.length === 0 && under.length === 0) {
    return <div className="w-full" style={{ height }} />
  }

  const cutoff = nowMs - FIVE_MIN_MS
  const toX = (timestamp: number) =>
    Math.max(0, Math.min(VIEW_WIDTH, ((timestamp - cutoff) / FIVE_MIN_MS) * VIEW_WIDTH))
  // Both series share one scale so grey placeholders and real values are
  // height-comparable; the dot tracks the main series' last point.
  const values = [...data, ...under].map((d) => d.value)
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
  const toY = (value: number) => height - ((value - lo) / (hi - lo)) * height

  const build = (points: DataPoint[]) => {
    type Pt = [number, number]
    const pts: Pt[] = points.map((d) => [toX(d.timestamp), toY(d.value)])
    const segments: Pt[][] = [[]]
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && points[i].timestamp - points[i - 1].timestamp > MAX_CONTIGUOUS_GAP_MS) {
        segments.push([])
      }
      segments[segments.length - 1].push(pts[i])
    }
    const linePath = (segment: Pt[]) => segment
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`)
      .join(' ')
    if (pts.length === 0) return { line: '', areaPath: '' }
    const areaPath = segments.map((segment) => {
      const firstX = segment[0][0].toFixed(2)
      const lastX = segment[segment.length - 1][0].toFixed(2)
      return `${linePath(segment)} L${lastX} ${height} L${firstX} ${height} Z`
    }).join(' ')
    return { line: segments.map(linePath).join(' '), areaPath }
  }

  const grey = build(under)
  const main = build(data)
  const xs = data.map((d) => toX(d.timestamp))
  const lastY = data.length > 0 ? toY(data[data.length - 1].value) : 0

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
          <linearGradient id={greyGid} x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={UNDERLAY_COLOR} stopOpacity={0.28} />
            <stop offset="100%" stopColor={UNDERLAY_COLOR} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        {under.length > 0 && (
          <>
            <path d={grey.areaPath} fill={`url(#${greyGid})`} stroke="none" />
            <path
              d={grey.line}
              fill="none"
              stroke={UNDERLAY_COLOR}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </>
        )}
        <path
          d={main.areaPath}
          fill={`url(#${gid})`}
          stroke="none"
        />
        <path
          d={main.line}
          fill="none"
          stroke={color}
          strokeWidth={1.7}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {showDot && data.length > 0 && (
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
