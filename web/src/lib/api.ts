import type { Tokens } from './types'

const TOKENS_KEY = 'vettly.tokens'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const tokenStore = {
  get(): Tokens | null {
    try {
      const raw = localStorage.getItem(TOKENS_KEY)
      return raw ? (JSON.parse(raw) as Tokens) : null
    } catch {
      return null
    }
  },
  set(tokens: Tokens | null) {
    try {
      if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
      else localStorage.removeItem(TOKENS_KEY)
    } catch {
      /* storage unavailable: session lasts for this tab only */
    }
  },
}

/** Notified when refresh fails, so the auth context can sign the user out. */
let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

// Concurrent 401s share one refresh round-trip; refresh tokens are single-use.
let refreshing: Promise<boolean> | null = null

async function refreshTokens(): Promise<boolean> {
  const current = tokenStore.get()
  if (!current) return false
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) return false
      const body = (await res.json()) as { tokens: Tokens }
      tokenStore.set(body.tokens)
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || 'Request failed'
  try {
    const body = (await res.json()) as { message?: string | string[] }
    if (body.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, message)
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers)
  const tokens = tokenStore.get()
  if (tokens) headers.set('Authorization', `Bearer ${tokens.accessToken}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const res = await fetch(`/api${path}`, { ...init, headers })

  if (res.status === 401 && retry && tokens) {
    if (await refreshTokens()) return api<T>(path, init, false)
    tokenStore.set(null)
    onUnauthorized()
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
