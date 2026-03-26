import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePresence } from '../contexts/PresenceContext'

export const WORKSPACE_ID = 'main'

const LOCK_TTL_MS = 20000
const HEARTBEAT_MS = 4500
const LETTER_REMOTE_OWNERSHIP_MS = 180
const LETTER_BROADCAST_MS = 70
const LETTER_FRICTION = 0.92
const LETTER_MIN_V = 0.00002
const LETTER_COLLISION_PAD_PX = 10

type LetterGroup = 'title' | 'lead'

/** Mitte des Teils in normalisierten Koordinaten 0–1 über die gesamte Spielfläche */
export type PartModel = {
  id: string
  label: string
  kind: 'gear' | 'plate' | 'rod' | 'letter'
  fill?: 'yellow' | 'red' | 'blue' | 'ink'
  nx: number
  ny: number
  r: number
  linkedTo?: string
  wN?: number
  hN?: number
  letterGroup?: LetterGroup
}

type DragState = {
  id: string
  offsetNx: number
  offsetNy: number
  hadLock: boolean
}

type PhysicsState = {
  vx: number
  vy: number
  vr: number
  remoteOwnedUntil: number
  lastBroadcastAt: number
}

const INITIAL: PartModel[] = [
  { id: 'rad-eins', label: '', kind: 'gear', fill: 'ink', nx: 0.18, ny: 0.36, r: 0 },
  { id: 'rad-zwei', label: '', kind: 'gear', fill: 'ink', nx: 0.68, ny: 0.4, r: 0 },
  { id: 'steg', label: '', kind: 'rod', fill: 'ink', nx: 0.82, ny: 0.32, r: 90 },
  { id: 'platte', label: '', kind: 'plate', fill: 'ink', nx: 0.48, ny: 0.55, r: 0 },
]

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function snapDistPx(w: number, h: number) {
  const m = Math.min(w, h)
  return Math.max(40, m * 0.11)
}

function distPx(a: PartModel, b: PartModel, w: number, h: number) {
  return Math.hypot((a.nx - b.nx) * w, (a.ny - b.ny) * h)
}

function tryLinkGears(parts: PartModel[], w: number, h: number): PartModel[] {
  const snap = snapDistPx(w, h)
  const gears = parts.filter((p) => p.kind === 'gear')
  if (gears.length < 2 || w <= 0 || h <= 0) return parts
  let next = parts.map((p) => ({ ...p }))
  for (let i = 0; i < gears.length; i++) {
    for (let j = i + 1; j < gears.length; j++) {
      const a = next.find((p) => p.id === gears[i].id)!
      const b = next.find((p) => p.id === gears[j].id)!
      if (distPx(a, b, w, h) <= snap) {
        next = next.map((p) =>
          p.id === a.id ? { ...p, linkedTo: b.id } : p,
        )
        next = next.map((p) =>
          p.id === b.id ? { ...p, linkedTo: a.id } : p,
        )
        return next
      }
    }
  }
  return next
}

function tryUnlinkIfFar(parts: PartModel[], w: number, h: number): PartModel[] {
  const snap = snapDistPx(w, h)
  const next = parts.map((p) => ({ ...p }))
  let changed = false
  for (const p of next) {
    if (!p.linkedTo) continue
    const o = next.find((q) => q.id === p.linkedTo)
    if (!o) continue
    if (distPx(p, o, w, h) > snap * 1.35) {
      p.linkedTo = undefined
      o.linkedTo = undefined
      changed = true
    }
  }
  return changed ? next : parts
}

function nearestGearPairPreview(
  parts: PartModel[],
  dragId: string | null,
  w: number,
  h: number,
): { a: PartModel; b: PartModel } | null {
  if (!dragId || w <= 0 || h <= 0) return null
  const snap = snapDistPx(w, h)
  const previewMax = snap * 1.75
  const d = parts.find((p) => p.id === dragId)
  if (!d || d.kind !== 'gear') return null
  const gears = parts.filter((p) => p.kind === 'gear' && p.id !== d.id)
  let best: PartModel | null = null
  let bestD = Infinity
  for (const g of gears) {
    const dd = distPx(d, g, w, h)
    if (dd < bestD) {
      bestD = dd
      best = g
    }
  }
  if (!best || bestD > previewMax || bestD <= snap) return null
  if (d.linkedTo && d.linkedTo === best.id) return null
  return { a: d, b: best }
}

function clearTextSelection() {
  const sel = window.getSelection?.()
  if (sel && sel.rangeCount > 0) sel.removeAllRanges()
}

function setDraggingChrome(active: boolean) {
  document.documentElement.classList.toggle('kinetic-dragging', active)
}

function readSize(el: HTMLDivElement | null) {
  if (!el) {
    return {
      w: typeof window !== 'undefined' ? window.innerWidth : 1,
      h: typeof window !== 'undefined' ? window.innerHeight : 1,
    }
  }
  const r = el.getBoundingClientRect()
  return {
    w: Math.max(1, r.width),
    h: Math.max(1, r.height),
  }
}

function collisionRadiusPx(part: PartModel, w: number, h: number) {
  if (part.kind === 'letter') {
    const pxW = Math.max(8, (part.wN ?? 0.012) * w)
    const pxH = Math.max(10, (part.hN ?? 0.022) * h)
    return Math.max(pxW, pxH) * 0.42
  }
  if (part.kind === 'gear') return Math.max(26, Math.min(w, h) * 0.055)
  if (part.kind === 'rod') return Math.max(26, Math.min(w, h) * 0.06)
  return Math.max(24, Math.min(w, h) * 0.052)
}

function applyLetterBounds(part: PartModel, ps: PhysicsState) {
  if (part.nx <= 0 || part.nx >= 1) ps.vx *= -0.45
  if (part.ny <= 0 || part.ny >= 1) ps.vy *= -0.45
  part.nx = clamp01(part.nx)
  part.ny = clamp01(part.ny)
}

function mapSourceCharsToParts(surface: HTMLDivElement): PartModel[] {
  const sourceChars = Array.from(
    document.querySelectorAll<HTMLElement>('[data-letter-source="char"]'),
  )
  if (sourceChars.length === 0) return []
  const surfaceRect = surface.getBoundingClientRect()
  const w = Math.max(1, surfaceRect.width)
  const h = Math.max(1, surfaceRect.height)
  const result: PartModel[] = []
  for (const node of sourceChars) {
    const ch = node.dataset.letterChar ?? node.textContent ?? ''
    if (ch.trim().length === 0) continue
    const r = node.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const group = (node.dataset.letterGroup === 'lead' ? 'lead' : 'title') as LetterGroup
    const line = node.dataset.letterLine ?? '0'
    const idx = node.dataset.letterIndex ?? '0'
    const id = `letter-${group}-${line}-${idx}`
    const nx = (r.left + r.width * 0.5 - surfaceRect.left) / w
    const ny = (r.top + r.height * 0.5 - surfaceRect.top) / h
    result.push({
      id,
      label: ch,
      kind: 'letter',
      nx: clamp01(nx),
      ny: clamp01(ny),
      r: 0,
      wN: Math.max(0.003, r.width / w),
      hN: Math.max(0.008, r.height / h),
      letterGroup: group,
    })
  }
  return result
}

export function KineticField() {
  const { user } = useAuth()
  const { broadcastPart, lastRemoteParts } = usePresence()
  const benchRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(() => readSize(null))
  const [parts, setParts] = useState<PartModel[]>(INITIAL)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lettersHydratedRef = useRef(false)
  const physicsRef = useRef<Record<string, PhysicsState>>({})
  const rafRef = useRef<number | null>(null)
  const dragSessionEndedRef = useRef(false)
  const removeDocumentDragListenersRef = useRef<(() => void) | null>(null)
  const dragCaptureRef = useRef<{ pointerId: number; el: HTMLElement } | null>(null)

  const uid = user?.id

  const getPhysics = useCallback((partId: string) => {
    const map = physicsRef.current
    if (!map[partId]) {
      map[partId] = {
        vx: 0,
        vy: 0,
        vr: 0,
        remoteOwnedUntil: 0,
        lastBroadcastAt: 0,
      }
    }
    return map[partId]
  }, [])

  useLayoutEffect(() => {
    const el = benchRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize(readSize(el))
    })
    ro.observe(el)
    setSize(readSize(el))
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (lettersHydratedRef.current) return
    const el = benchRef.current
    if (!el) return
    const hydrate = () => {
      if (lettersHydratedRef.current || !benchRef.current) return
      const letters = mapSourceCharsToParts(benchRef.current)
      if (letters.length === 0) return
      lettersHydratedRef.current = true
      setParts((prev) => {
        const nonLetters = prev.filter((p) => p.kind !== 'letter')
        return [...nonLetters, ...letters]
      })
    }

    const timer1 = window.setTimeout(hydrate, 80)
    const timer2 = window.setTimeout(hydrate, 260)
    const timer3 = window.setTimeout(hydrate, 700)
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => hydrate())
    }
    hydrate()
    return () => {
      window.clearTimeout(timer1)
      window.clearTimeout(timer2)
      window.clearTimeout(timer3)
    }
  }, [size.w, size.h])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const releaseLock = useCallback(
    async (partId: string) => {
      stopHeartbeat()
      if (!supabase || !uid) return
      await supabase
        .from('part_locks')
        .delete()
        .eq('workspace_id', WORKSPACE_ID)
        .eq('part_id', partId)
        .eq('holder_id', uid)
    },
    [stopHeartbeat, uid],
  )

  const refreshLock = useCallback(
    async (partId: string) => {
      if (!supabase || !uid) return
      const until = new Date(Date.now() + LOCK_TTL_MS).toISOString()
      await supabase
        .from('part_locks')
        .update({ expires_at: until })
        .eq('workspace_id', WORKSPACE_ID)
        .eq('part_id', partId)
        .eq('holder_id', uid)
    },
    [uid],
  )

  const tryAcquireLock = useCallback(
    async (partId: string) => {
      if (!isSupabaseConfigured || !supabase || !uid) return true
      const { data: row } = await supabase
        .from('part_locks')
        .select('holder_id, expires_at')
        .eq('workspace_id', WORKSPACE_ID)
        .eq('part_id', partId)
        .maybeSingle()

      const now = Date.now()
      if (row) {
        const exp = new Date(row.expires_at as string).getTime()
        if (exp > now && row.holder_id !== uid) return false
      }

      const { error } = await supabase.from('part_locks').upsert(
        {
          workspace_id: WORKSPACE_ID,
          part_id: partId,
          holder_id: uid,
          expires_at: new Date(now + LOCK_TTL_MS).toISOString(),
        },
        { onConflict: 'workspace_id,part_id' },
      )
      return !error
    },
    [uid],
  )

  const clientToNorm = useCallback((clientX: number, clientY: number) => {
    const el = benchRef.current
    if (!el) return { nx: 0.5, ny: 0.5 }
    const r = el.getBoundingClientRect()
    const w = Math.max(1, r.width)
    const h = Math.max(1, r.height)
    const nx = (clientX - r.left) / w
    const ny = (clientY - r.top) / h
    return { nx: clamp01(nx), ny: clamp01(ny) }
  }, [])

  const applyDragClientPosition = useCallback(
    (clientX: number, clientY: number) => {
      const d = dragRef.current
      if (!d) return
      const pos = clientToNorm(clientX, clientY)
      const { w, h } = readSize(benchRef.current)
      setParts((prev) => {
        const next = prev.map((p) =>
          p.id === d.id
            ? {
                ...p,
                nx: clamp01(pos.nx - d.offsetNx),
                ny: clamp01(pos.ny - d.offsetNy),
              }
            : p,
        )
        const moved = next.find((p) => p.id === d.id)
        if (moved) {
          const s = getPhysics(moved.id)
          s.vx = 0
          s.vy = 0
          s.vr = 0
          broadcastPart(moved.id, moved.nx, moved.ny, moved.r)
        }
        return tryUnlinkIfFar(next, w, h)
      })
    },
    [broadcastPart, clientToNorm, getPhysics],
  )

  const endDragSession = useCallback(async () => {
    if (dragSessionEndedRef.current) return
    dragSessionEndedRef.current = true
    removeDocumentDragListenersRef.current?.()
    removeDocumentDragListenersRef.current = null

    setDraggingChrome(false)
    clearTextSelection()

    const cap = dragCaptureRef.current
    dragCaptureRef.current = null
    const d = dragRef.current
    dragRef.current = null
    setActiveDragId(null)

    if (cap) {
      try {
        cap.el.releasePointerCapture(cap.pointerId)
      } catch {
        /* noop */
      }
    }
    if (!d) return
    if (d.hadLock) await releaseLock(d.id)

    const { w, h } = readSize(benchRef.current)
    setParts((prev) => tryLinkGears(prev, w, h))
  }, [releaseLock])

  function attachDocumentDragListeners(pointerId: number) {
    removeDocumentDragListenersRef.current?.()
    const onDocMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || dragSessionEndedRef.current) return
      ev.preventDefault()
      applyDragClientPosition(ev.clientX, ev.clientY)
    }
    const onDocEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      document.removeEventListener('pointermove', onDocMove)
      document.removeEventListener('pointerup', onDocEnd)
      document.removeEventListener('pointercancel', onDocEnd)
      removeDocumentDragListenersRef.current = null
      void endDragSession()
    }
    document.addEventListener('pointermove', onDocMove, { passive: false })
    document.addEventListener('pointerup', onDocEnd)
    document.addEventListener('pointercancel', onDocEnd)
    removeDocumentDragListenersRef.current = () => {
      document.removeEventListener('pointermove', onDocMove)
      document.removeEventListener('pointerup', onDocEnd)
      document.removeEventListener('pointercancel', onDocEnd)
    }
  }

  const onPointerDown = async (
    e: ReactPointerEvent<HTMLElement>,
    part: PartModel,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    if (!benchRef.current) return

    dragSessionEndedRef.current = false
    removeDocumentDragListenersRef.current?.()
    removeDocumentDragListenersRef.current = null

    setDraggingChrome(true)
    clearTextSelection()

    const capEl = e.currentTarget as HTMLElement
    try {
      capEl.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    dragCaptureRef.current = { pointerId: e.pointerId, el: capEl }

    const pos = clientToNorm(e.clientX, e.clientY)
    dragRef.current = {
      id: part.id,
      offsetNx: pos.nx - part.nx,
      offsetNy: pos.ny - part.ny,
      hadLock: false,
    }
    setActiveDragId(part.id)
    attachDocumentDragListeners(e.pointerId)

    const needsLock = part.kind !== 'letter'
    if (needsLock) {
      let lockOk = false
      try {
        lockOk = await tryAcquireLock(part.id)
      } catch {
        lockOk = false
      }
      if (dragRef.current?.id !== part.id) return
      dragRef.current = { ...dragRef.current, hadLock: lockOk }
      if (lockOk) {
        stopHeartbeat()
        heartbeatRef.current = setInterval(() => {
          void refreshLock(part.id)
        }, HEARTBEAT_MS)
      }
    }
  }

  const onPartPointerMove = (e: ReactPointerEvent<HTMLElement>, part: PartModel) => {
    if (dragRef.current?.id !== part.id || dragSessionEndedRef.current) return
    e.preventDefault()
    applyDragClientPosition(e.clientX, e.clientY)
  }

  const onPointerUp = async (e: ReactPointerEvent<HTMLElement>) => {
    const cap = dragCaptureRef.current
    if (cap && e.pointerId !== cap.pointerId) return
    e.preventDefault()
    removeDocumentDragListenersRef.current?.()
    removeDocumentDragListenersRef.current = null
    await endDragSession()
  }

  useEffect(() => {
    const { w, h } = size
    setParts((prev) => {
      const draggingId = dragRef.current?.id ?? activeDragId
      const merged = prev.map((p) => {
        if (p.id === draggingId) return p
        const r = lastRemoteParts[p.id]
        if (!r) return p
        if (p.kind === 'letter') {
          const ps = getPhysics(p.id)
          ps.vx = 0
          ps.vy = 0
          ps.vr = 0
          ps.remoteOwnedUntil = performance.now() + LETTER_REMOTE_OWNERSHIP_MS
        }
        return { ...p, nx: clamp01(r.nx), ny: clamp01(r.ny), r: r.r }
      })
      return tryLinkGears(tryUnlinkIfFar(merged, w, h), w, h)
    })
  }, [lastRemoteParts, activeDragId, size, getPhysics])

  useEffect(() => {
    if (!activeDragId) return
    const onSelectStart = (ev: Event) => ev.preventDefault()
    const onDragStart = (ev: Event) => ev.preventDefault()
    document.addEventListener('selectstart', onSelectStart, { capture: true })
    document.addEventListener('dragstart', onDragStart, { capture: true })
    const onWindowPointerEnd = () => {
      /* Pointer-Up ausserhalb des Buttons: Session zuverlässig beenden */
      if (dragRef.current) void endDragSession()
      else {
        setDraggingChrome(false)
        clearTextSelection()
      }
    }
    window.addEventListener('pointerup', onWindowPointerEnd)
    window.addEventListener('pointercancel', onWindowPointerEnd)
    return () => {
      document.removeEventListener('selectstart', onSelectStart, { capture: true })
      document.removeEventListener('dragstart', onDragStart, { capture: true })
      window.removeEventListener('pointerup', onWindowPointerEnd)
      window.removeEventListener('pointercancel', onWindowPointerEnd)
      setDraggingChrome(false)
    }
  }, [activeDragId, endDragSession])

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tick = () => {
      const now = performance.now()
      const { w, h } = readSize(benchRef.current)
      setParts((prev) => {
        if (prev.every((p) => p.kind !== 'letter')) return prev
        const dragId = dragRef.current?.id ?? activeDragId
        const dragging = dragId ? prev.find((p) => p.id === dragId) ?? null : null
        let changed = false
        const next = prev.map((part) => {
          if (part.kind !== 'letter') return part

          const ps = getPhysics(part.id)
          if (now < ps.remoteOwnedUntil && dragId !== part.id) return part

          let updated = part
          if (dragging && dragging.id !== part.id) {
            const dragR = collisionRadiusPx(dragging, w, h)
            const letterR = collisionRadiusPx(part, w, h)
            const maxDist = dragR + letterR + LETTER_COLLISION_PAD_PX
            const dxPx = (part.nx - dragging.nx) * w
            const dyPx = (part.ny - dragging.ny) * h
            const dist = Math.hypot(dxPx, dyPx)
            if (dist > 0 && dist < maxDist) {
              const force = ((maxDist - dist) / maxDist) * 0.0046
              ps.vx += (dxPx / dist) * force
              ps.vy += (dyPx / dist) * force
              ps.vr += ((Math.random() * 2 - 1) * force * 120) / Math.max(letterR, 1)
            }
          }

          const moving = Math.abs(ps.vx) > LETTER_MIN_V || Math.abs(ps.vy) > LETTER_MIN_V || Math.abs(ps.vr) > 0.02
          if (moving && dragId !== part.id) {
            updated = {
              ...part,
              nx: part.nx + ps.vx,
              ny: part.ny + ps.vy,
              r: part.r + ps.vr,
            }
            applyLetterBounds(updated, ps)
            ps.vx *= LETTER_FRICTION
            ps.vy *= LETTER_FRICTION
            ps.vr *= 0.88
            if (now - ps.lastBroadcastAt >= LETTER_BROADCAST_MS) {
              ps.lastBroadcastAt = now
              broadcastPart(updated.id, updated.nx, updated.ny, updated.r)
            }
            changed = true
          }

          return updated
        })
        return changed ? next : prev
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [activeDragId, broadcastPart, getPhysics])

  const { w, h } = size
  const preview = nearestGearPairPreview(parts, activeDragId, w, h)

  return (
    <div className="kinetic-wrap">
      <div
        ref={benchRef}
        className="kinetic-surface"
      >
        <svg
          className="kinetic-wires"
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          aria-hidden
        >
          {preview && (
            <line
              x1={preview.a.nx * w}
              y1={preview.a.ny * h}
              x2={preview.b.nx * w}
              y2={preview.b.ny * h}
              className="kinetic-wire kinetic-wire--preview"
            />
          )}
          {parts.map((p) => {
            if (!p.linkedTo) return null
            const o = parts.find((q) => q.id === p.linkedTo)
            if (!o || p.id > o.id) return null
            return (
              <line
                key={`${p.id}-${o.id}`}
                x1={p.nx * w}
                y1={p.ny * h}
                x2={o.nx * w}
                y2={o.ny * h}
                className="kinetic-wire kinetic-wire--live"
              />
            )
          })}
        </svg>
        {parts
          .filter((p) => p.kind === 'letter')
          .map((p) => (
          <button
            key={p.id}
            type="button"
            className={[
              'kinetic-part',
              `kind-${p.kind}`,
              p.kind === 'letter' ? `letter-${p.letterGroup ?? 'title'}` : `fill-${p.fill ?? 'ink'}`,
              p.linkedTo ? 'is-linked' : '',
            ].join(' ')}
            style={{
              left: `${p.nx * 100}%`,
              top: `${p.ny * 100}%`,
              width: p.kind === 'letter' ? `${Math.max((p.wN ?? 0.012) * w, 10)}px` : undefined,
              height: p.kind === 'letter' ? `${Math.max((p.hN ?? 0.02) * h, 14)}px` : undefined,
              transform: `translate(-50%, -50%) rotate(${p.r}deg)`,
            }}
            aria-label={
              p.kind === 'gear'
                ? 'Rad, ziehbar'
                : p.kind === 'rod'
                  ? 'Stab, ziehbar'
                  : p.kind === 'plate'
                    ? 'Platte, ziehbar'
                    : `Buchstabe ${p.label}, ziehbar`
            }
            onPointerDown={(e) => void onPointerDown(e, p)}
            onPointerMove={(e) => onPartPointerMove(e, p)}
            onPointerUp={(e) => void onPointerUp(e)}
            onPointerCancel={(e) => void onPointerUp(e)}
          >
            {p.kind === 'letter' ? p.label : null}
          </button>
        ))}
        {parts
          .filter((p) => p.kind !== 'letter')
          .map((p) => (
          <button
            key={p.id}
            type="button"
            className={[
              'kinetic-part',
              `kind-${p.kind}`,
              p.kind === 'letter' ? `letter-${p.letterGroup ?? 'title'}` : `fill-${p.fill ?? 'ink'}`,
              p.linkedTo ? 'is-linked' : '',
            ].join(' ')}
            style={{
              left: `${p.nx * 100}%`,
              top: `${p.ny * 100}%`,
              width: p.kind === 'letter' ? `${Math.max((p.wN ?? 0.012) * w, 10)}px` : undefined,
              height: p.kind === 'letter' ? `${Math.max((p.hN ?? 0.02) * h, 14)}px` : undefined,
              transform: `translate(-50%, -50%) rotate(${p.r}deg)`,
            }}
            aria-label={
              p.kind === 'gear'
                ? 'Rad, ziehbar'
                : p.kind === 'rod'
                  ? 'Stab, ziehbar'
                  : p.kind === 'plate'
                    ? 'Platte, ziehbar'
                    : `Buchstabe ${p.label}, ziehbar`
            }
            onPointerDown={(e) => void onPointerDown(e, p)}
            onPointerMove={(e) => onPartPointerMove(e, p)}
            onPointerUp={(e) => void onPointerUp(e)}
            onPointerCancel={(e) => void onPointerUp(e)}
          >
            {p.kind === 'letter' ? p.label : null}
          </button>
        ))}
      </div>
    </div>
  )
}
