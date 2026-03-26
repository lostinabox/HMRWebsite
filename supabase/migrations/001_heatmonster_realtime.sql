-- HeatMonster: part soft-locks + monster snapshots (öffentliche Galerie ohne Signatur im UI)
-- Im Supabase SQL Editor ausführen oder via CLI migrieren.
-- Dashboard: Authentication → Anonymous sign-ins aktivieren.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Part locks (Soft Lock pro Werkstatt + Teil)
-- ---------------------------------------------------------------------------
create table if not exists public.part_locks (
  workspace_id text not null,
  part_id text not null,
  holder_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  primary key (workspace_id, part_id)
);

alter table public.part_locks replica identity full;
alter table public.part_locks enable row level security;

create policy "part_locks_select"
  on public.part_locks for select
  to authenticated
  using (true);

create policy "part_locks_insert_own"
  on public.part_locks for insert
  to authenticated
  with check (holder_id = auth.uid());

create policy "part_locks_update_own_or_expired"
  on public.part_locks for update
  to authenticated
  using (
    holder_id = auth.uid()
    or expires_at < now()
  )
  with check (holder_id = auth.uid());

create policy "part_locks_delete_own"
  on public.part_locks for delete
  to authenticated
  using (holder_id = auth.uid());

grant select, insert, update, delete on public.part_locks to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.monster_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  state jsonb not null,
  thumbnail_url text,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade
);

alter table public.monster_snapshots enable row level security;

revoke all on public.monster_snapshots from public;
grant insert on public.monster_snapshots to authenticated;

create policy "monster_snapshots_insert_own"
  on public.monster_snapshots for insert
  to authenticated
  with check (created_by = auth.uid());

-- Öffentliche Galerie: nur Spalten ohne created_by (View nutzt Rechte des Owners)
create or replace view public.monster_snapshots_public
with (security_invoker = false)
as
  select id, created_at, state, thumbnail_url
  from public.monster_snapshots;

grant select on public.monster_snapshots_public to anon, authenticated;

-- Realtime für Locks (optional): Supabase → Database → Replication
-- Falls der folgende Befehl fehlt, in der Konsole hinzufügen:
-- alter publication supabase_realtime add table public.part_locks;

comment on table public.part_locks is 'Soft locks for collaborative workbench parts';
comment on table public.monster_snapshots is 'Persisted builds; clients read monster_snapshots_public';
comment on view public.monster_snapshots_public is 'Public gallery; no created_by';
