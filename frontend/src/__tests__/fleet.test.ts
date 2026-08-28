import { describe, expect, it } from 'vitest'
import {
  COOL,
  CRIT,
  FIVE_MIN_MS,
  GOOD,
  WARN,
  alpha,
  fmt,
  fmtSeconds,
  firstTokColor,
  gpuTempColor,
  goodputColor,
  memFreeColor,
  queueColor,
  sumSeries,
  tarColor,
  windowedMean,
  wholeAnswerColor,
  type DataPoint,
} from '@/lib/fleet'

const pt = (timestamp: number, value: number): DataPoint => ({ timestamp, value })

describe('fmt', () => {
  it('abbreviates millions with one decimal and drops trailing .0', () => {
    expect(fmt(130_100_000)).toBe('130.1M')
    expect(fmt(1_000_000)).toBe('1M')
  })

  it('abbreviates thousands with one decimal and drops trailing .0', () => {
    expect(fmt(4_300)).toBe('4.3k')
    expect(fmt(1_000)).toBe('1k')
    expect(fmt(1300)).toBe('1.3k')
  })

  it('rounds to an integer at or above 100', () => {
    expect(fmt(100)).toBe('100')
    expect(fmt(999)).toBe('999')
    expect(fmt(1547)).toBe('1.5k')
  })

  it('keeps one decimal below 100', () => {
    expect(fmt(24.6)).toBe('24.6')
    expect(fmt(0)).toBe('0.0')
  })

  it('never renders NaN for non-finite input', () => {
    expect(fmt(Number.NaN)).toBe('0')
    expect(fmt(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('fmtSeconds', () => {
  it('renders seconds with one decimal from milliseconds', () => {
    expect(fmtSeconds(12672)).toBe('12.7')
    expect(fmtSeconds(500)).toBe('0.5')
    expect(fmtSeconds(4305)).toBe('4.3')
  })
})

describe('windowedMean', () => {
  const now = 1_000_000

  it('averages only points within the trailing 5-min window', () => {
    const points: DataPoint[] = [
      pt(now - FIVE_MIN_MS - 1, 100), // just outside -> dropped
      pt(now - FIVE_MIN_MS, 10), // exactly on the boundary -> included
      pt(now - 60_000, 20),
      pt(now, 30),
    ]
    expect(windowedMean(points, now)).toBe(20)
  })

  it('returns null when no points fall in the window', () => {
    expect(windowedMean([pt(now - FIVE_MIN_MS - 10, 5)], now)).toBeNull()
    expect(windowedMean([], now)).toBeNull()
  })
})

describe('sumSeries', () => {
  it('adds values aligned by timestamp across multiple series', () => {
    const a: DataPoint[] = [pt(1, 1), pt(2, 2)]
    const b: DataPoint[] = [pt(1, 10), pt(3, 30)]
    const c: DataPoint[] = [pt(2, 200)]
    const summed = sumSeries([a, b, c])

    expect(summed).toEqual([
      { timestamp: 1, value: 11 },
      { timestamp: 2, value: 202 },
      { timestamp: 3, value: 30 },
    ])
  })

  it('returns nothing when every series is empty', () => {
    expect(sumSeries([[], []])).toEqual([])
  })
})

describe('color thresholds', () => {
  it('firstTokColor: <=0.5s GOOD, <=2s WARN, else CRIT', () => {
    expect(firstTokColor(500)).toBe(GOOD)
    expect(firstTokColor(2000)).toBe(WARN)
    expect(firstTokColor(2001)).toBe(CRIT)
    expect(firstTokColor(10)).toBe(GOOD)
  })

  it('wholeAnswerColor: <=5s GOOD, <=15s WARN, else CRIT', () => {
    expect(wholeAnswerColor(5000)).toBe(GOOD)
    expect(wholeAnswerColor(15000)).toBe(WARN)
    expect(wholeAnswerColor(15001)).toBe(CRIT)
  })

  it('goodputColor: >=90 GOOD, >=50 WARN, else CRIT', () => {
    expect(goodputColor(90)).toBe(GOOD)
    expect(goodputColor(50)).toBe(WARN)
    expect(goodputColor(49)).toBe(CRIT)
  })

  it('tarColor: >=60 GOOD, >=30 WARN, else CRIT', () => {
    expect(tarColor(60)).toBe(GOOD)
    expect(tarColor(30)).toBe(WARN)
    expect(tarColor(29)).toBe(CRIT)
  })

  it('memFreeColor: <8 CRIT, <24 WARN, else GOOD', () => {
    expect(memFreeColor(7.9)).toBe(CRIT)
    expect(memFreeColor(23.9)).toBe(WARN)
    expect(memFreeColor(24)).toBe(GOOD)
  })

  it('queueColor: 0 GOOD, <8 WARN, else CRIT', () => {
    expect(queueColor(0)).toBe(GOOD)
    expect(queueColor(7)).toBe(WARN)
    expect(queueColor(8)).toBe(CRIT)
  })

  it('gpuTempColor: <70 GOOD, <85 WARN, else CRIT', () => {
    expect(gpuTempColor(69)).toBe(GOOD)
    expect(gpuTempColor(84)).toBe(WARN)
    expect(gpuTempColor(85)).toBe(CRIT)
  })
})


describe('alpha', () => {
  it('appends an explicit alpha channel to an oklch token', () => {
    expect(alpha(GOOD, 0.08)).toBe('oklch(0.80 0.18 140 / 0.08)')
    expect(alpha(COOL, 0.25)).toBe('oklch(0.78 0.13 225 / 0.25)')
  })
})
