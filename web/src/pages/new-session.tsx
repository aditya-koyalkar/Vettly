import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { DocumentPicker } from '@/components/document-picker'
import { Button } from '@/components/ui/button'
import { DIFFICULTIES, INTERVIEW_TYPES } from '@/lib/format'
import { useCreateSession } from '@/lib/queries'
import type { Difficulty, InterviewType } from '@/lib/types'
import { cn } from '@/lib/utils'

const STEPS = ['Resume', 'Job description', 'Interview settings'] as const
const DURATIONS = [10, 20, 30, 45]

export function NewSessionPage() {
  const navigate = useNavigate()
  const create = useCreateSession()
  const [step, setStep] = useState(0)
  const [resumeId, setResumeId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [type, setType] = useState<InterviewType>('MIXED')
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM')
  const [duration, setDuration] = useState(20)

  const canContinue = [Boolean(resumeId), Boolean(jobId), true][step]

  async function submit() {
    if (!resumeId || !jobId) return
    try {
      const session = await create.mutateAsync({
        resumeId,
        jobDescriptionId: jobId,
        type,
        difficulty,
        durationMinutes: duration,
      })
      navigate(`/app/sessions/${session.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the interview')
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">New practice interview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Three quick steps. Your interviewer is built from what you add here.</p>

      <ol className="mt-8 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium',
                i < step && 'border-primary bg-primary text-primary-foreground',
                i === step && 'border-primary text-primary',
                i > step && 'text-muted-foreground',
              )}
              aria-current={i === step ? 'step' : undefined}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('hidden text-sm sm:inline', i === step ? 'font-medium' : 'text-muted-foreground')}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      <section className="mt-6 rounded-xl border bg-card p-5 sm:p-6">
        {step === 0 && (
          <StepIntro title="Your resume" body="Questions will reference your real projects and experience.">
            <DocumentPicker kind="RESUME" selectedId={resumeId} onSelect={setResumeId} />
          </StepIntro>
        )}
        {step === 1 && (
          <StepIntro title="The job you’re preparing for" body="Paste the full posting; requirements drive what gets probed.">
            <DocumentPicker kind="JOB_DESCRIPTION" selectedId={jobId} onSelect={setJobId} />
          </StepIntro>
        )}
        {step === 2 && (
          <div className="space-y-6">
            <Choice
              legend="Format"
              options={INTERVIEW_TYPES}
              value={type}
              onChange={setType}
            />
            <Choice legend="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} columns={3} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Length</legend>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={duration === d}
                    onClick={() => setDuration(d)}
                    className={cn(
                      'rounded-lg border px-4 py-2 text-sm tabular-nums transition-colors hover:bg-muted/60',
                      duration === d && 'border-primary bg-primary/5 font-medium text-primary',
                    )}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </section>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={() => (step ? setStep(step - 1) : navigate('/app'))}>
          <ArrowLeft /> {step ? 'Back' : 'Cancel'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button disabled={!canContinue} onClick={() => setStep(step + 1)}>
            Continue <ArrowRight />
          </Button>
        ) : (
          <Button size="lg" disabled={create.isPending} onClick={submit}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Build my interview
          </Button>
        )}
      </div>
    </div>
  )
}

function StepIntro({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-medium">{title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  )
}

function Choice<K extends string>({
  legend,
  options,
  value,
  onChange,
  columns = 2,
}: {
  legend: string
  options: Record<K, { label: string; description: string }>
  value: K
  onChange: (v: K) => void
  columns?: 2 | 3
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className={cn('grid gap-2', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')} role="radiogroup">
        {(Object.keys(options) as K[]).map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            onClick={() => onChange(key)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
              value === key && 'border-primary bg-primary/5 ring-2 ring-primary/15',
            )}
          >
            <div className="text-sm font-medium">{options[key].label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{options[key].description}</div>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
