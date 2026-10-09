import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMetricsHistory } from '../hooks/useMetricsHistory'
import { engineKey } from '../lib/identity'
import type { MetricsSnapshot } from '../types/metrics'

const baseSnapshot: MetricsSnapshot = {
  timestamp_ms: 1000,
  gpu: {
    index: 0,
    name: 'GPU 0',
    utilization_percent: 11,
    memory_total_bytes: 24,
    memory_used_bytes: 6,
    temperature_celsius: 40,
    power_watts: 100,
    power_limit_watts: 300,
    clock_graphics_mhz: 1800,
    clock_sm_mhz: 1800,
    clock_memory_mhz: 9000,
    fan_speed_percent: 30,
  },
  gpus: [],
  cpu: { name: 'CPU', aggregate_percent: 25, per_core: [] },
  memory: {
    source_available: true,
    total_bytes: 128,
    display_total_bytes: 128,
    used_bytes: 64,
    available_bytes: 64,
    cached_bytes: 8,
    gpu_estimated_bytes: null,
    gpu_memory_total_bytes: null,
    gpu_memory_used_bytes: null,
    is_unified: false,
  },
  disk: { name: 'disk', read_bytes_per_sec: 1, write_bytes_per_sec: 2 },
  network: { name: 'net', rx_bytes_per_sec: 3, tx_bytes_per_sec: 4 },
  engines: [],
  gpu_events: [],
}

/** One 1s engine poll of the fields the PP latch reads. Snapshot ts = engine
 *  ts + 100 (scrape lag), matching the production sampler. */
const poll = (
  sampled_at_ms: number,
  opts: {
    active: number
    purePrefill: number
    tps: number
    lastReqPp?: number
    pp5min?: number
  },
) => ({
  ...baseSnapshot,
  timestamp_ms: sampled_at_ms + 100,
  engines: [{
    engine_type: 'Vllm' as const,
    endpoint: 'http://localhost:8000',
    status: { type: 'Running' as const },
    model: null,
    deployment_mode: 'Docker' as const,
    gpu_indexes: [],
    recent_requests: [],
    sampled_at_ms,
    metrics: {
      tokens_per_sec: opts.tps,
      tokens_per_sec_interval_ms: 1_000,
      last_req_pp: opts.lastReqPp ?? null,
      pp_5min: opts.pp5min ?? null,
      pp_lifetime: null,
      pure_prefill_tokens: opts.purePrefill,
      last_req_tg: null,
      active_requests: opts.active,
      queued_requests: 0,
      total_requests: 2,
    },
  } as unknown as MetricsSnapshot['engines'][number]],
})

describe('useMetricsHistory PP square wave + grey working latch', () => {
  it('grey raises live, green backfills exactly [grey start → PP end] and replaces grey', () => {
    const { result, rerender } = renderHook(
      ({ snapshot }) => useMetricsHistory(snapshot),
      { initialProps: { snapshot: null as MetricsSnapshot | null } },
    )
    const key = engineKey(poll(0, { active: 0, purePrefill: 0, tps: 0 }).engines[0])
    const green = () => result.current.getPpChart(key)
    const grey = () => result.current.getPpGreyChart(key)

    // Idle.
    act(() => rerender({ snapshot: poll(1_000, { active: 0, purePrefill: 0, tps: 0 }) }))
    expect(green()).toEqual([])
    expect(grey()).toEqual([])

    // Request arrives: grey raises, frozen at the 5-min PP average. Open
    // window draws live to the snapshot timestamp (engine ts + 100ms).
    act(() => rerender({ snapshot: poll(2_000, { active: 1, purePrefill: 0, tps: 0, pp5min: 2_000 }) }))
    expect(green()).toEqual([])
    expect(grey()).toEqual([
      { timestamp: 1_999, value: 0 },
      { timestamp: 2_000, value: 2_000 },
      { timestamp: 2_100, value: 2_000 },
      { timestamp: 2_101, value: 0 },
    ])

    // Still prefilling one poll later (window grows with `now`).
    act(() => rerender({ snapshot: poll(3_000, { active: 1, purePrefill: 0, tps: 0, pp5min: 2_000 }) }))
    expect(grey()).toEqual([
      { timestamp: 1_999, value: 0 },
      { timestamp: 2_000, value: 2_000 },
      { timestamp: 3_100, value: 2_000 },
      { timestamp: 3_101, value: 0 },
    ])

    // First token (PP end): grey locks at [2000 → 4000] and stays visible
    // until the completion record replaces it.
    act(() => rerender({ snapshot: poll(4_000, { active: 1, purePrefill: 0, tps: 30 }) }))
    expect(green()).toEqual([])
    expect(grey()).toEqual([
      { timestamp: 1_999, value: 0 },
      { timestamp: 2_000, value: 2_000 },
      { timestamp: 4_000, value: 2_000 },
      { timestamp: 4_001, value: 0 },
    ])

    // Decode, including a transient zero sample: no re-raise, no change.
    act(() => rerender({ snapshot: poll(5_000, { active: 1, purePrefill: 0, tps: 30 }) }))
    act(() => rerender({ snapshot: poll(5_500, { active: 1, purePrefill: 0, tps: 0 }) }))
    expect(grey()).toEqual([
      { timestamp: 1_999, value: 0 },
      { timestamp: 2_000, value: 2_000 },
      { timestamp: 4_000, value: 2_000 },
      { timestamp: 4_001, value: 0 },
    ])

    // Completion record lands at request end (6000) but the green block sits
    // at [grey start → PP end] = [2000 → 4000] at the true rate — and the
    // grey placeholder is deleted, not kept underneath.
    act(() => rerender({
      snapshot: poll(6_000, { active: 1, purePrefill: 3_700, tps: 0, lastReqPp: 1_000 }),
    }))
    expect(green()).toEqual([
      { timestamp: 1_999, value: 0 },
      { timestamp: 2_000, value: 1_000 },
      { timestamp: 4_000, value: 1_000 },
      { timestamp: 4_001, value: 0 },
    ])
    expect(grey()).toEqual([])

    // Idle, then a back-to-back request that completes within one poll of its
    // prefill (grey never observed separately): same replace semantics.
    act(() => rerender({ snapshot: poll(7_000, { active: 0, purePrefill: 3_700, tps: 0 }) }))
    act(() => rerender({
      snapshot: poll(8_000, { active: 1, purePrefill: 3_700, tps: 0, pp5min: 2_500 }),
    }))
    expect(grey()).toEqual([
      { timestamp: 7_999, value: 0 },
      { timestamp: 8_000, value: 2_500 },
      { timestamp: 8_100, value: 2_500 },
      { timestamp: 8_101, value: 0 },
    ])
    act(() => rerender({
      snapshot: poll(9_000, { active: 1, purePrefill: 7_400, tps: 0, lastReqPp: 1_000 }),
    }))
    expect(green()).toEqual([
      { timestamp: 1_999, value: 0 },
      { timestamp: 2_000, value: 1_000 },
      { timestamp: 4_000, value: 1_000 },
      { timestamp: 4_001, value: 0 },
      { timestamp: 7_999, value: 0 },
      { timestamp: 8_000, value: 1_000 },
      { timestamp: 9_000, value: 1_000 },
      { timestamp: 9_001, value: 0 },
    ])
    expect(grey()).toEqual([])

    // Wide block (>2.5s) keeps its top connected: interior points every 2s
    // stay under the renderer's segment-break threshold.
    act(() => rerender({
      snapshot: poll(10_000, { active: 1, purePrefill: 7_400, tps: 0, pp5min: 3_000 }),
    }))
    act(() => rerender({
      snapshot: poll(13_000, { active: 1, purePrefill: 13_400, tps: 0, lastReqPp: 1_000 }),
    }))
    expect(green()).toEqual([
      { timestamp: 1_999, value: 0 },
      { timestamp: 2_000, value: 1_000 },
      { timestamp: 4_000, value: 1_000 },
      { timestamp: 4_001, value: 0 },
      { timestamp: 7_999, value: 0 },
      { timestamp: 8_000, value: 1_000 },
      { timestamp: 9_000, value: 1_000 },
      { timestamp: 9_001, value: 0 },
      { timestamp: 9_999, value: 0 },
      { timestamp: 10_000, value: 1_000 },
      { timestamp: 12_000, value: 1_000 },
      { timestamp: 13_000, value: 1_000 },
      { timestamp: 13_001, value: 0 },
    ])
    expect(grey()).toEqual([])
  })
})
