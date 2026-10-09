import { useState, useEffect, useRef } from 'react'
import type { MetricsSnapshot } from '../types/metrics'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

export function useMetrics() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [isStale, setIsStale] = useState(false)
  const lastMessageTime = useRef<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)

  // `connect` is declared inside the effect rather than as a `useCallback`
  // because the reconnect path schedules `connect` itself. A `useCallback`
  // cannot reference its own binding without reading it before it is
  // initialised; a function declaration in the effect scope is hoisted, so
  // the self-reference is well-defined. The socket is a mount-scoped external
  // resource, so the effect is its natural owner anyway.
  useEffect(() => {
    function connect() {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnectionStatus('connected')
        attemptRef.current = 0
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as MetricsSnapshot
          lastMessageTime.current = Date.now()
          setMetrics(data)
          setIsStale(false)
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = () => {
        wsRef.current = null
        setConnectionStatus('reconnecting')
        const delay = Math.min(1000 * Math.pow(2, attemptRef.current), 10000)
        attemptRef.current++
        reconnectTimeout.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()
    return () => {
      wsRef.current?.close()
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
    }
  }, [])

  // Staleness is checked separately from measurement delivery so render timing
  // cannot drop snapshots from the history layer.
  useEffect(() => {
    function checkStale() {
      if (connectionStatus === 'connected' && lastMessageTime.current > 0) {
        setIsStale(Date.now() - lastMessageTime.current > 5000)
      }
    }

    function onVisible() {
      if (!document.hidden) checkStale()
    }

    const id = setInterval(checkStale, 2000)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connectionStatus])

  return { metrics, connectionStatus, isStale }
}
