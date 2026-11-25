import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/auth'

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, setPending] = useState(false)
  const isRegister = mode === 'register'
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/app'

  if (user) return <Navigate to={redirectTo} replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    setPending(true)
    try {
      if (isRegister) await signUp(String(form.get('name')), email, password)
      else await signIn(email, password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isRegister ? 'Start practising with an AI interviewer in minutes.' : 'Sign in to continue practising.'}
          </p>
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {isRegister && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                minLength={isRegister ? 8 : undefined}
                required
              />
              {isRegister && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {isRegister ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isRegister ? 'Already have an account? ' : 'New to Vettly? '}
            <Link to={isRegister ? '/login' : '/register'} className="font-medium text-primary hover:underline">
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-[oklch(0.17_0.03_277)] p-12 text-white lg:flex lg:flex-col lg:justify-end">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-primary/40 blur-3xl" aria-hidden />
        <div className="relative max-w-md">
          <p className="text-xl leading-relaxed text-balance">
            An interviewer that has read your resume and the job description, asks follow-ups like a real
            one, and tells you exactly what to fix.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/70">
            <li>Questions grounded in your own projects</li>
            <li>Natural voice conversation with real-time turn-taking</li>
            <li>Scored debrief with a stronger answer for every question</li>
          </ul>
        </div>
      </aside>
    </div>
  )
}
