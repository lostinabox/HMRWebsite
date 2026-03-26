import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type AuthContextValue = {
  session: Session | null
  user: User | null
  ready: boolean
  signInAnonymous: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!isSupabaseConfigured)

  const signInAnonymous = useCallback(async () => {
    if (!supabase) {
      setReady(true)
      return
    }
    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) {
      console.error('[HeatMonster] Anonymous auth failed', error)
    }
    setSession(data.session ?? null)
    setReady(true)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return
    }

    let cancelled = false

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) {
        setSession(data.session)
        setReady(true)
      } else {
        void signInAnonymous()
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [signInAnonymous])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      ready,
      signInAnonymous,
    }),
    [session, ready, signInAnonymous],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
