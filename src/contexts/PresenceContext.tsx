import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export const CHANNEL_NAME = 'heatmonster:main'

const CURSOR_BROADCAST_THROTTLE_MS = 50
const PART_BROADCAST_THROTTLE_MS = 50

export type CursorPeer = {
  sid: string
  x: number
  y: number
  hue: number
}

/** Position relativ zur Spielfläche 0–1 (Mitte des Teils), geräteunabhängig */
export type PartBroadcast = {
  sid: string
  partId: string
  nx: number
  ny: number
  r: number
}

type PresenceContextValue = {
  channel: RealtimeChannel | null
  peers: CursorPeer[]
  updateCursor: (x: number, y: number) => void
  broadcastPart: (partId: string, nx: number, ny: number, r: number) => void
  lastRemoteParts: Record<string, PartBroadcast>
}

const PresenceContext = createContext<PresenceContextValue | null>(null)

function hueFromSid(sid: string) {
  let h = 0
  for (let i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) >>> 0
  return h % 360
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth()
  const sessionId = user?.id ?? 'local'

  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastCursorSendRef = useRef(0)
  const lastPartSendRef = useRef<Record<string, number>>({})

  const [channel, setChannel] = useState<RealtimeChannel | null>(null)
  const [peers, setPeers] = useState<CursorPeer[]>([])
  const [lastRemoteParts, setLastRemoteParts] = useState<
    Record<string, PartBroadcast>
  >({})

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !authReady || !user) {
      setChannel(null)
      channelRef.current = null
      return
    }

    const ch = supabase.channel(CHANNEL_NAME, {
      config: {
        broadcast: { self: false },
        presence: { key: sessionId },
      },
    })

    ch.on('broadcast', { event: 'cursor-move' }, ({ payload }) => {
      const p = payload as { sid?: string; x?: number; y?: number }
      if (!p.sid || p.x === undefined || p.y === undefined) return
      if (p.sid === sessionId) return
      setPeers((prev) => {
        const others = prev.filter((q) => q.sid !== p.sid)
        return [...others, { sid: p.sid!, x: p.x!, y: p.y!, hue: hueFromSid(p.sid!) }]
      })
    })
      .on('broadcast', { event: 'part-move' }, ({ payload }) => {
        const p = payload as PartBroadcast
        if (!p?.sid || p.sid === sessionId) return
        setLastRemoteParts((prev) => ({ ...prev, [p.partId]: p }))
      })

    void ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ user_id: sessionId, online_at: new Date().toISOString() })
      }
    })

    channelRef.current = ch
    setChannel(ch)

    return () => {
      void ch.unsubscribe()
      channelRef.current = null
      setChannel(null)
      setPeers([])
      setLastRemoteParts({})
    }
  }, [authReady, user, sessionId])

  const updateCursor = useCallback(
    (x: number, y: number) => {
      const ch = channelRef.current
      if (!ch) return
      const now = performance.now()
      if (now - lastCursorSendRef.current < CURSOR_BROADCAST_THROTTLE_MS) return
      lastCursorSendRef.current = now
      void ch.send({
        type: 'broadcast',
        event: 'cursor-move',
        payload: { sid: sessionId, x, y },
      })
    },
    [sessionId],
  )

  const broadcastPart = useCallback(
    (partId: string, nx: number, ny: number, r: number) => {
      const ch = channelRef.current
      if (!ch) return
      const now = performance.now()
      const last = lastPartSendRef.current[partId] ?? 0
      if (now - last < PART_BROADCAST_THROTTLE_MS) return
      lastPartSendRef.current[partId] = now
      void ch.send({
        type: 'broadcast',
        event: 'part-move',
        payload: { sid: sessionId, partId, nx, ny, r },
      })
    },
    [sessionId],
  )

  const value = useMemo(
    () => ({
      channel,
      peers,
      updateCursor,
      broadcastPart,
      lastRemoteParts,
    }),
    [channel, peers, updateCursor, broadcastPart, lastRemoteParts],
  )

  return (
    <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
  )
}

export function usePresence() {
  const ctx = useContext(PresenceContext)
  if (!ctx) throw new Error('usePresence must be used within PresenceProvider')
  return ctx
}
