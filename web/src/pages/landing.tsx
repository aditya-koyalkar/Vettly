import { ArrowRight, AudioLines, BrainCircuit, FileSearch, LineChart, Mic, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { Logo } from '@/components/brand'
import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/context/auth'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    icon: FileSearch,
    title: 'Add your resume and the job',
    body: 'Upload a PDF or paste text. Vettly indexes both and maps every requirement to evidence in your experience.',
  },
  {
    icon: Mic,
    title: 'Talk to your interviewer',
    body: 'A voice AI runs a realistic interview built from the gaps that matter, with follow-ups when answers are vague.',
  },
  {
    icon: LineChart,
    title: 'Get a hiring-committee debrief',
    body: 'Scores across technical depth and communication, a verdict, and a stronger answer for every question.',
  },
]

const FEATURES = [
  {
    icon: BrainCircuit,
    title: 'Planned by a team of agents',
    body: 'Resume and JD analysts, a fit analyst grounded by retrieval, and a planner that designs your loop.',
  },
  {
    icon: AudioLines,
    title: 'Conversation that feels real',
    body: 'Semantic turn detection waits while you think, noise cancellation cleans your mic, and you can interrupt naturally.',
  },
  {
    icon: ShieldCheck,
    title: 'Resilient by design',
    body: 'Speech and language models fail over across providers automatically, so a busy model never ends your session.',
  },
]

export function LandingPage() {
  const { user } = useAuth()
  const primaryCta = user ? '/app/new' : '/register'

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo />
        <nav className="flex items-center gap-2">
          {user ? (
            <Link to="/app" className={buttonVariants({ size: 'sm' })}>
              Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Sign in
              </Link>
              <Link to="/register" className={buttonVariants({ size: 'sm' })}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[28rem] max-w-3xl rounded-full bg-primary/15 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-20 text-center sm:pt-24">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" aria-hidden /> Voice mock interviews, tailored to you
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Practise the interview you’re actually about to have.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-balance">
            Vettly reads your resume and the job description, then an AI interviewer speaks with you, probes
            your real experience, and hands you an honest, specific debrief.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={primaryCta} className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-5 text-base')}>
              Start a practice interview <ArrowRight />
            </Link>
            <a href="#how" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 px-5 text-base')}>
              How it works
            </a>
          </div>
        </div>
      </section>

      <section id="how" className="border-y bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-px px-4 py-16 sm:grid-cols-3 sm:gap-8">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="py-6 sm:py-0">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-medium">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-balance">
          Built like a real interview loop, not a quiz.
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-6">
              <Icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-4 font-medium">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="relative overflow-hidden rounded-2xl bg-[oklch(0.17_0.03_277)] px-8 py-14 text-center text-white">
          <div className="absolute -bottom-32 left-1/2 size-80 -translate-x-1/2 rounded-full bg-primary/50 blur-3xl" aria-hidden />
          <h2 className="relative text-3xl font-semibold tracking-tight">Your next interview starts with a rehearsal.</h2>
          <p className="relative mt-3 text-white/70">Twenty minutes. One honest debrief. Every answer sharper.</p>
          <Link
            to={primaryCta}
            className={cn(buttonVariants({ size: 'lg' }), 'relative mt-8 h-11 bg-white px-5 text-base text-black hover:bg-white/90')}
          >
            Start practising <ArrowRight />
          </Link>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Vettly
      </footer>
    </div>
  )
}
