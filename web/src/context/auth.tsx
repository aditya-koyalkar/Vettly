import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, json, setUnauthorizedHandler, tokenStore } from '@/lib/api'
import type { Tokens, User } from '@/lib/types'

interface AuthState {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => tokenStore.get() !== null)

  const clear = useCallback(() => {
    tokenStore.set(null)
    setUser(null)
    qc.clear()
  }, [qc])

  useEffect(() => {
    setUnauthorizedHandler(clear)
    if (!tokenStore.get()) return
    api<{ user: User }>('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(clear)
      .finally(() => setLoading(false))
  }, [clear])

  const accept = useCallback((res: { user: User; tokens: Tokens }) => {
    tokenStore.set(res.tokens)
    setUser(res.user)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn: async (email, password) => accept(await api('/auth/signin', json({ email, password }))),
      signUp: async (name, email, password) => accept(await api('/auth/signup', json({ name, email, password }))),
      signOut: async () => {
        const tokens = tokenStore.get()
        await api('/auth/signout', json({ refreshToken: tokens?.refreshToken })).catch(() => {})
        clear()
      },
    }),
    [user, loading, accept, clear],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
