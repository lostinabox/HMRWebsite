import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    '[HeatMonster] VITE_SUPABASE_URL oder VITE_SUPABASE_ANON_KEY fehlt – Realtime/Locks/Galerie sind deaktiviert.',
  )
}

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null

export const isSupabaseConfigured = Boolean(supabase)
