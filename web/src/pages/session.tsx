import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  ChevronDown,
  Eye,
  EyeOff,
  FileSearch,
  Loader2,
  Mic,
  RotateCcw,
  Scale,
  Sparkles,
  Target,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ScoreBar, ScoreRing } from '@/components/score-ring'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CATEGORY_LABEL,
  DIFFICULTIES,
  INTERVIEW_TYPES,
  TONE_TEXT,
  VERDICT_LABEL,
  formatOffset,
  scoreTone,
} from '@/lib/format'
import { useSession, useSessionAction } from '@/lib/queries'
import type { FitAnalysis, InterviewPlan, InterviewReport, SessionDetail, TranscriptTurn } from '@/lib/types'
import { cn } from '@/lib/utils'

export function SessionPage() {
  const { id = '' } = useParams()
  const { data: session, isLoading, error } = useSession(id)

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />
  if (error || !session) {
    return <p className="text-sm text-muted-foreground">This session could not be found.</p>
  }

  return (
    <div>
      <Link to="/app" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Dashboard
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{session.title}</h1>
            <StatusBadge status={session.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {INTERVIEW_TYPES[session.type].label} · {DIFFICULTIES[session.difficulty].label} ·{' '}
            {session.durationMinutes} min · {session.resume.title} → {session.jobDescription.title}
          </p>
        </div>
      </div>

      {session.status === 'PREPARING' && <PipelineView kind="prep" />}
      {(session.status === 'READY' || session.status === 'IN_PROGRESS') && <PrepBrief session={session} />}
      {session.status === 'ANALYZING' && <PipelineView kind="analysis" />}
      {session.status === 'COMPLETED' && session.report && <ReportView session={session} report={session.report} />}
      {session.status === 'FAILED' && <FailedView session={session} />}
    </div>
  )
}

// ─── Pipelines in flight ─────────────────────────────────────────────────────

const PIPELINES = {
  prep: {
    title: 'Building your interview',
    body: 'A small team of agents is preparing a loop tailored to you. This usually takes under a minute.',
    agents: [
      { icon: FileSearch, name: 'Resume & JD analysts', detail: 'Extracting skills, projects and requirements' },
      { icon: Target, name: 'Evidence retriever', detail: 'Searching your resume for proof of each requirement' },
      { icon: Scale, name: 'Fit analyst', detail: 'Scoring strengths and gaps against the role' },
      { icon: BrainCircuit, name: 'Interview planner', detail: 'Designing questions and follow-ups' },
    ],
  },
  analysis: {
    title: 'Writing your debrief',
    body: 'Specialist evaluators are reviewing your transcript in parallel. Hang tight, this takes about a minute.',
    agents: [
      { icon: BrainCircuit, name: 'Technical evaluator', detail: 'Depth, problem solving, role relevance' },
      { icon: Mic, name: 'Communication coach', detail: 'Clarity, structure, conciseness, confidence' },
      { icon: FileSearch, name: 'Question reviewer', detail: 'Feedback and a stronger answer for each question' },
      { icon: Scale, name: 'Hiring committee', detail: 'Synthesising the verdict' },
    ],
  },
} as const

function PipelineView({ kind }: { kind: keyof typeof PIPELINES }) {
  const p = PIPELINES[kind]
  return (
    <section className="rounded-xl border bg-card p-6 sm:p-8" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <h2 className="text-lg font-medium">{p.title}</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {p.agents.map(({ icon: Icon, name, detail }) => (
          <li key={name} className="flex items-start gap-3 rounded-lg border bg-background p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <div className="text-sm font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">{detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FailedView({ session }: { session: SessionDetail }) {
  const retry = useSessionAction(session.id, 'retry')
  return (
    <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="size-4" /> Something went wrong
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{session.error ?? 'An unexpected error occurred.'}</p>
      <Button
        className="mt-4"
        disabled={retry.isPending}
        onClick={() => retry.mutateAsync().catch((e: Error) => toast.error(e.message))}
      >
        {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
      </Button>
    </section>
  )
}

// ─── Ready: prep brief ───────────────────────────────────────────────────────

function PrepBrief({ session }: { session: SessionDetail }) {
  const navigate = useNavigate()
  const fit = session.fitAnalysis
  const plan = session.plan

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {fit && <FitCard fit={fit} />}
        {plan && <PlanCard plan={plan} />}
      </div>
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-medium">Ready when you are</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Find a quiet spot and use headphones if you can.</li>
            <li>Speak naturally; pausing to think is fine. The interviewer waits for you.</li>
            <li>Ask it to repeat or skip a question any time.</li>
          </ul>
          <Button size="lg" className="mt-5 h-11 w-full text-base" onClick={() => navigate(`/app/sessions/${session.id}/live`)}>
            <Mic /> {session.status === 'IN_PROGRESS' ? 'Rejoin interview' : 'Start interview'}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">We’ll ask for microphone access.</p>
        </div>
      </aside>
    </div>
  )
}

function FitCard({ fit }: { fit: FitAnalysis }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreRing score={fit.matchScore} size={96} stroke={8} caption="match" />
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">How you match this role</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{fit.summary}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Strengths</h3>
          <ul className="space-y-2">
            {fit.strengths.slice(0, 5).map((s) => (
              <li key={s.requirement} className="text-sm">
                <span className="font-medium">{s.requirement}</span>
                <p className="text-xs text-muted-foreground">{s.evidence}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Gaps to prepare</h3>
          <ul className="space-y-2">
            {fit.gaps.slice(0, 5).map((g) => (
              <li key={g.requirement} className="text-sm">
                <span className="font-medium">{g.requirement}</span>{' '}
                <Badge variant={g.severity === 'high' ? 'destructive' : 'secondary'} className="ml-1 align-middle capitalize">
                  {g.severity}
                </Badge>
                <p className="text-xs text-muted-foreground">{g.advice}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function PlanCard({ plan }: { plan: InterviewPlan }) {
  const [reveal, setReveal] = useState(false)
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Your interview plan · {plan.questions.length} questions</h2>
        <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)}>
          {reveal ? <EyeOff /> : <Eye />} {reveal ? 'Hide questions' : 'Reveal questions'}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        For realistic practice, keep questions hidden and go in cold.
      </p>
      <ol className="mt-4 space-y-2">
        {plan.questions.map((q, i) => (
          <li key={q.id} className="flex gap-3 rounded-lg border bg-background p-3">
            <span className="text-xs font-medium text-muted-foreground tabular-nums">{String(i + 1).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{q.topic}</span>
                <Badge variant="outline">{CATEGORY_LABEL[q.category]}</Badge>
                <span className="text-xs text-muted-foreground">~{q.targetMinutes} min</span>
              </div>
              {reveal && <p className="mt-1 text-sm text-muted-foreground">{q.question}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ─── Completed: report ───────────────────────────────────────────────────────

function ReportView({ session, report }: { session: SessionDetail; report: InterviewReport }) {
  const tone = scoreTone(report.overallScore)
  const dimensions = [...report.dimensions].sort((a, b) => b.score - a.score)

  return (
    <div className="space-y-6">
      <section className="grid gap-6 rounded-xl border bg-card p-6 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={report.overallScore} caption="overall" />
          <span className={cn('text-sm font-medium', TONE_TEXT[tone])}>{VERDICT_LABEL[report.verdict]}</span>
        </div>
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <Sparkles className="size-4 text-primary" /> Debrief
          </h2>
          <p className="mt-2 leading-relaxed text-muted-foreground">{report.summary}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">What went well</h3>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {report.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Practise next</h3>
              <ol className="space-y-1.5 text-sm">
                {report.improvements.map((imp, i) => (
                  <li key={imp.area} className="flex gap-2">
                    <span className="text-xs font-medium text-primary tabular-nums">{i + 1}</span>
                    <span>
                      <span className="font-medium">{imp.area}:</span>{' '}
                      <span className="text-muted-foreground">{imp.action}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-6">
        <h2 className="font-medium">Scorecard</h2>
        <p className="text-xs text-muted-foreground">Each dimension scored 0–10, sorted high to low.</p>
        <ul className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
          {dimensions.map((d) => (
            <li key={d.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{d.label}</span>
                <span className="text-sm tabular-nums">
                  {d.score.toFixed(1)}
                  <span className="text-muted-foreground">/10</span>
                </span>
              </div>
              <ScoreBar score={d.score} label={d.label} />
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{d.rationale}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-6">
        <h2 className="font-medium">Question by question</h2>
        <div className="mt-4 divide-y">
          {report.questionReviews.map((r, i) => (
            <details key={`${r.questionId}-${i}`} className="group py-3">
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">{r.score.toFixed(1)}</span>
                <span className="min-w-0 flex-1 text-sm">{r.question}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 grid gap-3 pl-13 text-sm sm:grid-cols-2">
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground">What you said</h4>
                  <p className="mt-0.5">{r.answerSummary}</p>
                  <h4 className="mt-3 text-xs font-medium text-muted-foreground">Feedback</h4>
                  <p className="mt-0.5">{r.feedback}</p>
                </div>
                <div className="rounded-lg bg-primary/5 p-3">
                  <h4 className="text-xs font-medium text-primary">A stronger answer</h4>
                  <p className="mt-0.5 leading-relaxed">{r.strongerAnswer}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      <Transcript turns={session.turns} />
    </div>
  )
}

function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  const [open, setOpen] = useState(false)
  if (!turns.length) return null
  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Transcript</h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : `Show ${turns.length} turns`}
        </Button>
      </div>
      {open && (
        <ol className="mt-4 space-y-3">
          {turns.map((t) => (
            <li key={t.id} className="flex gap-3 text-sm">
              <span className="w-12 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">{formatOffset(t.offsetSec)}</span>
              <div>
                <span className={cn('text-xs font-medium', t.role === 'AGENT' ? 'text-primary' : 'text-foreground')}>
                  {t.role === 'AGENT' ? 'Interviewer' : 'You'}
                </span>
                <p className="leading-relaxed">{t.content}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
