import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, json } from './api'
import type {
  Difficulty,
  DocumentKind,
  InterviewType,
  RoomCredentials,
  SessionDetail,
  SessionStatus,
  SessionSummary,
  VettlyDocument,
} from './types'

export const keys = {
  documents: (kind?: DocumentKind) => ['documents', kind ?? 'all'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['sessions', id] as const,
}

/** Statuses where a background agent pipeline is still working. */
const WORKING: SessionStatus[] = ['PREPARING', 'ANALYZING', 'IN_PROGRESS']

export function useDocuments(kind?: DocumentKind) {
  return useQuery({
    queryKey: keys.documents(kind),
    queryFn: () => api<VettlyDocument[]>(kind ? `/documents?kind=${kind}` : '/documents'),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === 'PROCESSING') ? 2500 : false),
  })
}

export function useUploadDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { kind: DocumentKind; file?: File; text?: string; title?: string }) => {
      const form = new FormData()
      form.set('kind', input.kind)
      if (input.title) form.set('title', input.title)
      if (input.file) form.set('file', input.file)
      if (input.text) form.set('text', input.text)
      return api<VettlyDocument>('/documents', { method: 'POST', body: form })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: () => api<SessionSummary[]>('/sessions'),
    refetchInterval: (q) => (q.state.data?.some((s) => WORKING.includes(s.status)) ? 4000 : false),
  })
}

export function useSession(id: string) {
  return useQuery({
    queryKey: keys.session(id),
    queryFn: () => api<SessionDetail>(`/sessions/${id}`),
    refetchInterval: (q) => (q.state.data && WORKING.includes(q.state.data.status) ? 2500 : false),
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      resumeId: string
      jobDescriptionId: string
      type: InterviewType
      difficulty: Difficulty
      durationMinutes: number
      title?: string
    }) => api<{ id: string }>('/sessions', json(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sessions }),
  })
}

export function useSessionAction(id: string, action: 'retry' | 'end') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<unknown>(`/sessions/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.session(id) }),
  })
}

export function useRetakeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/sessions/${id}/retake`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sessions }),
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sessions }),
  })
}

export const joinSession = (id: string) => api<RoomCredentials>(`/sessions/${id}/join`, { method: 'POST' })
