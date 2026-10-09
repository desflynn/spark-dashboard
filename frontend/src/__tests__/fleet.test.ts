import { describe, expect, it } from 'vitest'
import {
  COOL,
  CRIT,
  FIVE_MIN_MS,
  GOOD,
  WARN,
  activeFleetWindowMean,
  activeWindowMean,
  alpha,
  fmt,
  fmtOptional,
  fmtSeconds,
  firstTokColor,
  gpuTempColor,
  goodputColor,
  memFreeColor,
  memoryBreakdown,
  queueColor,
  sumSeries,
  sumConcurrentSeries,
  tarColor,
  windowedMean,
  wholeAnswerColor,
  weightedSeries,
  type DataPoint,
} from '@/lib/fleet'

const pt = (timestamp: number, value: number): DataPoint => ({ timestamp, value })
const interval = (timestamp: number, durationMs: number, value: number): DataPoint => ({
  timestamp,
  durationMs,
  value,
})

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

describe('fmtOptional', () => {
  it('keeps measured zero distinct from missing data', () => {
    expect(fmtOptional(0)).toBe('0.0')
    expect(fmtOptional(null)).toBe('—')
    expect(fmtOptional(undefined)).toBe('—')
  })
})

describe('memoryBreakdown', () => {
  it('partitions the displayed pool without consuming available memory', () => {
    expect(memoryBreakdown({
      displayTotalBytes: 128,
      kernelTotalBytes: 122,
      usedBytes: 104,
      availableBytes: 18,
      cachedBytes: 8,
      gpuEstimatedBytes: 70,
    })).toEqual({
      gpuBytes: 70,
      hostBytes: 26,
      cacheBytes: 8,
      reservedBytes: 6,
      freeBytes: 18,
      inUseBytes: 104,
    })
  })

  it('clamps estimates so every segment remains non-negative', () => {
    expect(memoryBreakdown({
      displayTotalBytes: 16,
      kernelTotalBytes: 16,
      usedBytes: 4,
      availableBytes: 12,
      cachedBytes: 8,
      gpuEstimatedBytes: 10,
    })).toEqual({
      gpuBytes: 4,
      hostBytes: 0,
      cacheBytes: 0,
      reservedBytes: 0,
      freeBytes: 12,
      inUseBytes: 4,
    })
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

describe('activeWindowMean', () => {
  const now = 1_000_000

  it('excludes idle zero intervals but returns zero when the whole window is idle', () => {
    expect(activeWindowMean([
      interval(now - 290_000, 10_000, 100),
      interval(now, 290_000, 0),
    ], now)).toBe(100)
    expect(activeWindowMean([interval(now, 300_000, 0)], now)).toBe(0)
  })

  it('weights active rates by represented elapsed time rather than point count', () => {
    expect(activeWindowMean([
      interval(now - 30_000, 10_000, 100),
      interval(now, 30_000, 200),
    ], now)).toBe(175)
  })

  it('clips intervals at the five-minute boundary and distinguishes no data', () => {
    expect(activeWindowMean([
      interval(now - FIVE_MIN_MS + 10_000, 20_000, 80),
      interval(now, 10_000, 160),
    ], now)).toBe(120)
    expect(activeWindowMean([], now)).toBeNull()
  })

  it('does not change when the same active interval is sampled more often', () => {
    expect(activeWindowMean([interval(now, 10_000, 120)], now)).toBe(120)
    expect(activeWindowMean([
      interval(now - 5_000, 5_000, 120),
      interval(now, 5_000, 120),
    ], now)).toBe(120)
  })
})

describe('activeFleetWindowMean', () => {
  const now = 1_000_000

  it('sums overlapping engine rates before averaging active fleet time', () => {
    const engineA = [interval(now, 20_000, 100)]
    const engineB = [interval(now - 5_000, 10_000, 50)]

    // 10s at 100 + 10s at 150 = 125 active fleet tok/s.
    expect(activeFleetWindowMean([engineA, engineB], now)).toBe(125)
  })

  it('ignores periods where every engine is idle', () => {
    expect(activeFleetWindowMean([
      [interval(now - 100_000, 10_000, 90), interval(now, 90_000, 0)],
      [interval(now, 100_000, 0)],
    ], now)).toBe(90)
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

describe('sumConcurrentSeries', () => {
  it('sums asynchronous engine intervals on their real time boundaries', () => {
    expect(sumConcurrentSeries([
      [interval(20, 20, 100)],
      [interval(15, 10, 50)],
    ])).toEqual([
      { timestamp: 0, value: 100 },
      { timestamp: 5, value: 150 },
      { timestamp: 15, value: 100 },
      { timestamp: 20, value: 0 },
    ])
  })
})

describe('weightedSeries', () => {
  it('combines simultaneous latency means by their observation counts', () => {
    expect(weightedSeries([
      {
        values: [pt(1, 100), pt(2, 200)],
        weights: [pt(1, 10), pt(2, 20)],
      },
      {
        values: [pt(1, 500), pt(2, 400)],
        weights: [pt(1, 90), pt(2, 20)],
      },
    ])).toEqual([
      { timestamp: 1, value: 460 },
      { timestamp: 2, value: 300 },
    ])
  })

  it('does not invent an unweighted value when observation counts are absent', () => {
    expect(weightedSeries([{
      values: [pt(1, 100)],
      weights: [],
    }])).toEqual([])
  })

  it('combines asynchronous engine samples using each engine latest observation', () => {
    expect(weightedSeries([
      {
        values: [pt(10, 100), pt(20, 200)],
        weights: [pt(10, 20), pt(20, 20)],
      },
      {
        values: [pt(15, 500), pt(25, 300)],
        weights: [pt(15, 20), pt(25, 30)],
      },
    ])).toEqual([
      { timestamp: 10, value: 100 },
      { timestamp: 15, value: 300 },
      { timestamp: 20, value: 350 },
      { timestamp: 25, value: 260 },
    ])
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
