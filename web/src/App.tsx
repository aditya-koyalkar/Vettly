import { Loader2 } from 'lucide-react'
import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { useAuth } from '@/context/auth'
import { AuthPage } from '@/pages/auth'
import { DashboardPage } from '@/pages/dashboard'
import { DocumentsPage } from '@/pages/documents'
import { LandingPage } from '@/pages/landing'
import { NewSessionPage } from '@/pages/new-session'
import { SessionPage } from '@/pages/session'

// LiveKit's WebRTC client is large; load it only when a call starts.
const LiveInterviewPage = lazy(() => import('@/pages/live-interview').then((m) => ({ default: m.LiveInterviewPage })))

const spinner = (
  <div className="grid min-h-dvh place-items-center">
    <Loader2 className="size-5 animate-spin text-muted-foreground" />
  </div>
)

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return spinner
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="new" element={<NewSessionPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="sessions/:id" element={<SessionPage />} />
      </Route>
      {/* Full-screen, outside the shell */}
      <Route
        path="/app/sessions/:id/live"
        element={
          <RequireAuth>
            <Suspense fallback={spinner}>
              <LiveInterviewPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
