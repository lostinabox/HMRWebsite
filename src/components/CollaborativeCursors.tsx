import type { CursorPeer } from '../contexts/PresenceContext'

export function CollaborativeCursors({ peers }: { peers: CursorPeer[] }) {
  return (
    <>
      {peers.map((p) => (
        <div
          key={p.sid}
          className="collab-cursor"
          aria-hidden
          style={{
            transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
            transition: 'transform 80ms linear',
          }}
        >
          <span
            className="collab-cursor-dot"
            style={{ background: `hsl(${p.hue} 70% 52%)` }}
          />
        </div>
      ))}
    </>
  )
}
