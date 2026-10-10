import type { EngineSnapshot } from '@/types/metrics'

// This Spark's display names are independent of checkpoint paths and served IDs.
// Array order is also the presentation order; endpoints remain engine identities.
const DISPLAY_ENGINES = [
  { endpoint: 'http://localhost:18300', name: 'Qwen 3.8 0Z2' },
  { endpoint: 'http://localhost:18316', name: 'Qwen 3.8 27B' },
  { endpoint: 'http://localhost:18312', name: 'Ornith' },
  { endpoint: 'http://localhost:18314', name: 'Decider' },
]

export function engineDisplayOverride(engine: Pick<EngineSnapshot, 'endpoint'>): string | undefined {
  return DISPLAY_ENGINES.find(({ endpoint }) => endpoint === engine.endpoint)?.name
}

export function orderEnginesForDisplay<T extends Pick<EngineSnapshot, 'endpoint'>>(engines: readonly T[]): T[] {
  const rank = (engine: T) => {
    const index = DISPLAY_ENGINES.findIndex(({ endpoint }) => endpoint === engine.endpoint)
    return index < 0 ? DISPLAY_ENGINES.length : index
  }
  return [...engines].sort((a, b) => rank(a) - rank(b))
}
