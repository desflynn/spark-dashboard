import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMetrics } from '@/hooks/useMetrics'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor() {
    MockWebSocket.instances.push(this)
  }

  close() {}

  receive(timestamp_ms: number) {
    this.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ timestamp_ms }),
    }))
  }
}

describe('useMetrics measurement delivery', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('publishes every received measurement without waiting for the render throttle', () => {
    const { result } = renderHook(() => useMetrics())
    const socket = MockWebSocket.instances[0]

    act(() => socket.receive(1_000))
    expect(result.current.metrics?.timestamp_ms).toBe(1_000)

    act(() => socket.receive(2_000))
    expect(result.current.metrics?.timestamp_ms).toBe(2_000)
  })
})
