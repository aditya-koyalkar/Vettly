import { ArrowRight, Mic, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { StatusBadge } from '@/components/status-badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/context/auth'
import { DIFFICULTIES, INTERVIEW_TYPES, TONE_TEXT, VERDICT_LABEL, formatDate, scoreTone } from '@/lib/format'
import { useDeleteSession, useSessions } from '@/lib/queries'
import type { SessionSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

export function DashboardPage() {
  const { user } = useAuth()
  const { data: sessions, isLoading } = useSessions()
  const completed = sessions?.filter((s) => s.report) ?? []
  const avg = completed.length
    ? Math.round(completed.reduce((sum, s) => sum + (s.report?.overallScore ?? 0), 0) / completed.length)
    : null
  const best = completed.length ? Math.max(...completed.map((s) => s.report!.overallScore)) : null

  return (
    <>
      <PageHeader
        title={`Hi ${user?.name.split(' ')[0] ?? 'there'}`}
        description="Your practice interviews and how they went."
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Interviews completed" value={completed.length} />
        <Stat label="Average score" value={avg} suffix="/100" />
        <Stat label="Best score" value={best} suffix="/100" />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Sessions</h2>
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : sessions?.length ? (
        <ul className="grid gap-2">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </ul>
      ) : (
        <EmptyState />
      )}
    </>
  )
}

function Stat({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {value ?? '—'}
        {value != null && suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}

function SessionRow({ session: s }: { session: SessionSummary }) {
  const remove = useDeleteSession()
  const tone = s.report ? scoreTone(s.report.overallScore) : null

  return (
    <li className="group relative flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/app/sessions/${s.id}`} className="truncate font-medium after:absolute after:inset-0">
            {s.title}
          </Link>
          <StatusBadge status={s.status} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {INTERVIEW_TYPES[s.type].label} · {DIFFICULTIES[s.difficulty].label} · {s.durationMinutes} min ·{' '}
          {formatDate(s.createdAt)}
        </div>
      </div>
      {s.report && tone && (
        <div className="text-right">
          <div className={cn('text-xl font-semibold tabular-nums', TONE_TEXT[tone])}>
            {Math.round(s.report.overallScore)}
          </div>
          <div className="text-xs text-muted-foreground">{VERDICT_LABEL[s.report.verdict]}</div>
        </div>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete session"
        className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={async () => {
          if (!confirm('Delete this session and its report?')) return
          await remove.mutateAsync(s.id).catch((e: Error) => toast.error(e.message))
        }}
      >
        <Trash2 />
      </Button>
    </li>
  )
}

function EmptyState() {
  const navigate = useNavigate()
  return (
    <div className="grid place-items-center rounded-xl border border-dashed bg-card px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Mic className="size-5" aria-hidden />
      </span>
      <h3 className="mt-4 font-medium">No interviews yet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Add your resume and a job description, and Vettly will build a mock interview around them.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => navigate('/app/new')}>
          <Plus /> New interview
        </Button>
        <Link to="/app/documents" className={buttonVariants({ variant: 'outline' })}>
          Manage documents <ArrowRight />
        </Link>
      </div>
    </div>
  )
}
