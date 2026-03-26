# HeatMonster Website

Vite + React + TypeScript. Kinetisches Spielfeld (ziehbare Teile, Verbindungs-Linien) und Live-Cursor über Supabase Realtime mit Soft-Locks. Galerie / Server-Persistenz der Skulpturen sind derzeit nicht eingebunden.

## Lokales Setup

```bash
cp .env.example .env
# VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY eintragen (optional, für Cursors)
npm install
npm run dev
```

## Supabase

1. Projekt anlegen, **Authentication → Providers → Anonymous** einschalten.
2. SQL aus `supabase/migrations/001_heatmonster_realtime.sql` ausführen (Locks; Snapshots-Tabelle optional für später).

## Scripts

- `npm run dev` – Entwicklung
- `npm run build` – Produktionsbuild
- `npm run lint` – ESLint
