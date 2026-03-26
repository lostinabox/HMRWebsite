import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { PresenceProvider, usePresence } from './contexts/PresenceContext'
import { CollaborativeCursors } from './components/CollaborativeCursors'
import { KineticField } from './components/KineticField'
import { Modal } from './components/Modal'
import './App.css'

const HERO_TITLE_LINES = ['Weil spielerische', 'Begegnungen Freude', 'machen.']
const HERO_LEAD_LINE =
  'Entdecke HeatMonster – die interaktiven Begegnungsskulpturen für den öffentlichen und privaten Raum.'

function renderCharSpans(line: string, group: 'title' | 'lead', lineIndex: number) {
  return Array.from(line).map((ch, i) => (
    <span
      key={`${group}-${lineIndex}-${i}`}
      className="hero-char-source"
      data-letter-source="char"
      data-letter-group={group}
      data-letter-line={String(lineIndex)}
      data-letter-index={String(i)}
      data-letter-char={ch}
    >
      {ch === ' ' ? '\u00A0' : ch}
    </span>
  ))
}

function Shell({ children }: { children: ReactNode }) {
  const { ready } = useAuth()
  const { updateCursor, peers } = usePresence()
  const reducedMotion = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (!ready || reducedMotion.current) return
    const onMove = (e: MouseEvent) => updateCursor(e.clientX, e.clientY)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [ready, updateCursor])

  return (
    <>
      <CollaborativeCursors peers={peers} />
      {children}
    </>
  )
}

function AppInner() {
  const [modal, setModal] = useState<
    null | 'geschichte' | 'skulpturen' | 'mieten' | 'mitgestalten' | 'impressum' | 'datenschutz' | 'cookies'
  >(null)

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">HeatMonster</span>
        </div>
        <nav className="nav">
          <button type="button" className="btn btn-ghost" onClick={() => setModal('geschichte')}>
            Geschichte
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setModal('skulpturen')}>
            Skulpturen
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setModal('mieten')}>
            Mieten
          </button>
        </nav>
      </header>

      <main className="main">
        <section className="hero">
          <p className="hero-kicker">Nicht weil es nötig ist.</p>
          <div className="hero-text-source" aria-hidden>
            <h1 className="hero-title hero-title-source">
              {HERO_TITLE_LINES.map((line, lineIndex) => (
                <span className="hero-source-line" key={`title-${lineIndex}`}>
                  {renderCharSpans(line, 'title', lineIndex)}
                  {lineIndex < HERO_TITLE_LINES.length - 1 ? <br /> : null}
                </span>
              ))}
            </h1>
            <p className="hero-lead hero-lead-source">{renderCharSpans(HERO_LEAD_LINE, 'lead', 0)}</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => setModal('mitgestalten')}>
              Mitgestalten
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setModal('mieten')}>
              Mieten
            </button>
          </div>
        </section>
      </main>

      <section className="kinetic-stage" aria-label="Kinetischer Bereich">
        <KineticField />
      </section>

      <footer className="footer">
        <div className="footer-links">
          <button type="button" className="link" onClick={() => setModal('impressum')}>
            Impressum
          </button>
          <button type="button" className="link" onClick={() => setModal('datenschutz')}>
            Datenschutz
          </button>
          <button type="button" className="link" onClick={() => setModal('cookies')}>
            Cookies
          </button>
        </div>
      </footer>

      <Modal open={modal === 'geschichte'} title="Geschichte" onClose={() => setModal(null)}>
        <p>
          Platzhalter: Geschichte Text.
        </p>
      </Modal>

      <Modal open={modal === 'skulpturen'} title="Skulpturen" onClose={() => setModal(null)}>
        <p>
          Platzhalter: Skulpturen Text.
        </p>
      </Modal>

      <Modal open={modal === 'mieten'} title="Mieten" onClose={() => setModal(null)}>
        <p>
          Du betreibst einen Ort—ein Restaurant, einen Hof, einen Betrieb. Du willst Gespräche,
          die von selbst entstehen, nicht weil du sie erzwingst, sondern weil es gut tut.
        </p>
        <p>
          HeatMonster liefert die Skulptur: ganzjährig da, im Winter als Pelletbetrieb, im Sommer als
          Laterne oder Windspiel. Du stellst den Rahmen; zwischen euch entsteht Wärme.
        </p>
        <p className="modal-cta">
          <a className="btn btn-primary" href="mailto:hallo@heatmonster.ch">
            Schreib uns
          </a>
        </p>
      </Modal>

      <Modal open={modal === 'mitgestalten'} title="Mitgestalten" onClose={() => setModal(null)}>
        <p>
          Du baust Dinge, die weiterwirken. Du magst Metall, das Geschichten erzählt, wenn sich
          Menschen daran vorbeibewegen.
        </p>
        <p>Wir rufen die erste HeatMonster-Familie aus. Bring eine Idee mit, die verbindet.</p>
        <p className="modal-cta">
          <a className="btn btn-primary" href="mailto:family@heatmonster.ch">
            Nur kurz deine Idee schicken
          </a>
        </p>
      </Modal>

      <Modal open={modal === 'impressum'} title="Impressum" onClose={() => setModal(null)}>
        <p className="legal-placeholder">
          Platzhalter: Firmenangaben, UID, Adresse, Kontakt, verantwortliche Person. Bitte durch eure
          rechtsigen Angaben ersetzen.
        </p>
      </Modal>

      <Modal open={modal === 'datenschutz'} title="Datenschutz" onClose={() => setModal(null)}>
        <p className="legal-placeholder">
          Platzhalter: Datenbearbeitung (inkl. anonyme Supabase-Session und Realtime-Cursor). Bitte
          durch eure Datenschutzerklärung ersetzen.
        </p>
      </Modal>

      <Modal open={modal === 'cookies'} title="Cookies" onClose={() => setModal(null)}>
        <p className="legal-placeholder">
          Platzhalter: technisch notwendige Cookies vs. optionale, Consent falls nötig. Bitte
          rechtlich prüfen und ersetzen.
        </p>
      </Modal>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <PresenceProvider>
        <Shell>
          <AppInner />
        </Shell>
      </PresenceProvider>
    </AuthProvider>
  )
}
