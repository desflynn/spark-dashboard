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
  gpus: [
    {
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
    {
      index: 1,
      name: 'GPU 1',
      utilization_percent: 77,
      memory_total_bytes: 48,
      memory_used_bytes: 32,
      temperature_celsius: 61,
      power_watts: 220,
      power_limit_watts: 300,
      clock_graphics_mhz: 2100,
      clock_sm_mhz: 2100,
      clock_memory_mhz: 9500,
      fan_speed_percent: 45,
    },
  ],
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

describe('useMetricsHistory multi-GPU metrics', () => {
  it('keeps per-GPU chart series separate while preserving primary GPU keys', () => {
    const { result, rerender } = renderHook(
      ({ metrics }) => useMetricsHistory(metrics),
      { initialProps: { metrics: null as MetricsSnapshot | null } },
    )

    act(() => rerender({ metrics: baseSnapshot }))

    expect(result.current.getChartData('gpuUtil').map((p) => p.value)).toEqual([11])
    expect(result.current.getChartData('gpu:0:gpuUtil').map((p) => p.value)).toEqual([11])
    expect(result.current.getChartData('gpu:1:gpuUtil').map((p) => p.value)).toEqual([77])
    expect(result.current.getChartData('gpu:1:gpuPower').map((p) => p.value)).toEqual([220])
  })

  it('rejects out-of-order snapshots and records represented elapsed time', () => {
    const { result, rerender } = renderHook(
      ({ metrics }) => useMetricsHistory(metrics),
      { initialProps: { metrics: null as MetricsSnapshot | null } },
    )

    act(() => rerender({ metrics: baseSnapshot }))
    act(() => rerender({
      metrics: {
        ...baseSnapshot,
        timestamp_ms: 2_500,
        cpu: { ...baseSnapshot.cpu, aggregate_percent: 40 },
      },
    }))
    act(() => rerender({
      metrics: {
        ...baseSnapshot,
        timestamp_ms: 2_000,
        cpu: { ...baseSnapshot.cpu, aggregate_percent: 99 },
      },
    }))

    expect(result.current.getChartData('cpuAggregate')).toEqual([
      { timestamp: 1_000, value: 25, durationMs: 0 },
      { timestamp: 2_500, value: 40, durationMs: 1_500 },
    ])
  })

  it('records each engine scrape once using the engine measurement timestamp', () => {
    const metrics = (sampled_at_ms: number, tokens_per_sec: number) => ({
      ...baseSnapshot,
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
          tokens_per_sec,
          tokens_per_sec_interval_ms: 1_000,
          last_req_pp: null,
          pp_5min: null,
          pp_lifetime: null,
          pure_prefill_tokens: null,
          last_req_tg: null,
        },
      } as unknown as MetricsSnapshot['engines'][number]],
    })
    const { result, rerender } = renderHook(
      ({ snapshot }) => useMetricsHistory(snapshot),
      { initialProps: { snapshot: null as MetricsSnapshot | null } },
    )

    act(() => rerender({ snapshot: { ...metrics(900, 10), timestamp_ms: 1_000 } }))
    act(() => rerender({ snapshot: { ...metrics(900, 10), timestamp_ms: 2_000 } }))
    act(() => rerender({ snapshot: { ...metrics(2_900, 20), timestamp_ms: 3_000 } }))

    expect(result.current.getChartData(`${engineKey(metrics(900, 10).engines[0])}:tps`)).toEqual([
      { timestamp: 900, value: 10, durationMs: 1_000 },
      { timestamp: 2_900, value: 20, durationMs: 1_000 },
    ])
  })
})
