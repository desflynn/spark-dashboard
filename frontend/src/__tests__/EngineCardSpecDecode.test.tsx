import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngineCard } from '../components/engines/EngineCard'
import type { EngineMetrics, EngineSnapshot } from '../types/metrics'

/** Minimal but complete EngineMetrics, spec-decode fields null by default. */
function metrics(overrides: Partial<EngineMetrics> = {}): EngineMetrics {
  return {
    tokens_per_sec: 100,
    tokens_per_sec_interval_ms: 1000,
    avg_tokens_per_sec: 80,
    per_request_tps: 50,
    ttft_ms: 120,
    ttft_observations: 10,
    active_requests: 1,
    queued_requests: 0,
    kv_cache_percent: 40,
    kv_cache_is_estimated: false,
    total_requests: 10,
    e2e_latency_ms: 500,
    e2e_observations: 10,
    last_req_pp: null,
    pp_5min: null,
    pp_lifetime: null,
    pure_prefill_tokens: null,
    last_req_tg: null,
    swapped_requests: 0,
    prefix_cache_hit_rate: 30,
    queue_time_ms: 50,
    inter_token_latency_ms: 25,
    itl_observations: 100,
    preemptions_total: 0,
    total_prompt_tokens: 1000,
    total_generation_tokens: 2000,
    prefix_cache_queries_total: 5000,
    avg_batch_size: 4,
    ttft_percentiles: null,
    itl_percentiles: null,
    e2e_percentiles: null,
    ttft_goodput_pct: null,
    itl_goodput_pct: null,
    e2e_goodput_pct: null,
    ttft_buckets: null,
    itl_buckets: null,
    e2e_buckets: null,
    tpot_ms: 28,
    tpot_observations: 100,
    tpot_percentiles: null,
    tpot_goodput_pct: null,
    tpot_buckets: null,
    spec_decode_draft_tokens_total: null,
    spec_decode_accepted_tokens_total: null,
    spec_decode_drafts_total: null,
    spec_decode_acceptance_rate: null,
    spec_decode_acceptance_rate_live: null,
    spec_decode_mean_acceptance_length: null,
    ...overrides,
  }
}

function snapshot(m: EngineMetrics | null): EngineSnapshot {
  return {
    engine_type: 'Vllm',
    endpoint: 'http://localhost:8000',
    status: { type: 'Running' },
    model: {
      name: 'test/model',
      parameter_size: null,
      quantization: null,
      precision: null,
      tensor_type: null,
      model_type: null,
      pipeline_tag: null,
    },
    metrics: m,
    sampled_at_ms: m ? 1000 : null,
    recent_requests: [],
    deployment_mode: 'Docker',
  }
}

describe('EngineCard speculative-decoding section', () => {
  it('always renders the renamed cache card header', () => {
    render(<EngineCard engine={snapshot(metrics())} />)
    expect(screen.getByText('Cache & Speculative Decoding')).toBeTruthy()
  })

  it('hides the spec-decode section when the model has no spec-decode metrics', () => {
    render(<EngineCard engine={snapshot(metrics())} />)
    expect(screen.queryByText('Speculative Decoding')).toBeNull()
    expect(screen.queryByText('Accept Len')).toBeNull()
  })

  it('renders TAR, acceptance length, and accepted/draft counters when enabled', () => {
    render(
      <EngineCard
        engine={snapshot(
          metrics({
            spec_decode_draft_tokens_total: 100_000,
            spec_decode_accepted_tokens_total: 72_000,
            spec_decode_drafts_total: 24_000,
            spec_decode_acceptance_rate: 72,
            spec_decode_acceptance_rate_live: 68,
            spec_decode_mean_acceptance_length: 3,
          }),
        )}
      />,
    )
    expect(screen.getByText('Speculative Decoding')).toBeTruthy()
    expect(screen.getByText('72')).toBeTruthy()
    expect(screen.getByText(/68% live/)).toBeTruthy()
    expect(screen.getByText('Accept Len')).toBeTruthy()
    expect(screen.getByText('Accepted')).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
  })
})
