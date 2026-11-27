import {
  BarVisualizer,
  RoomAudioRenderer,
  SessionProvider,
  StartAudio,
  useAgent,
  useMediaDeviceSelect,
  useSession,
  useSessionMessages,
  useTrackToggle,
} from '@livekit/components-react'
import { Room, Track, TokenSource } from 'livekit-client'
import { Loader2, Mic, MicOff, PhoneOff, Headphones, ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { joinSession, useSession as useInterviewSession } from '@/lib/queries'
import { cn } from '@/lib/utils'

/**
 * Full-screen voice interview. Joining fetches a LiveKit token whose room
 * configuration dispatches the interviewer agent; everything after that is
 * WebRTC between the browser and the agent.
 */
export function LiveInterviewPage() {
  const { id = '' } = useParams()
  const { data: interview } = useInterviewSession(id)
  const tokenSource = useMemo(
    () =>
      TokenSource.custom(async () => {
        const creds = await joinSession(id)
        return { serverUrl: creds.serverUrl, participantToken: creds.token }
      }),
    [id],
  )
  const room = useMemo(
    () =>
      new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        // Disable Opus DTX so soft speech from external mics is never gated as silence.
        publishDefaults: {
          dtx: false,
          red: true,
        },
      }),
    [],
  )
  const session = useSession(tokenSource, { room, agentConnectTimeoutMilliseconds: 30_000 })
  const sessionRef = useRef(session)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // Leave the room only if the user actually unmounts mid-call (not on session state transitions or StrictMode mount).
  useEffect(() => {
    return () => {
      if (sessionRef.current.connectionState !== 'disconnected') {
        void sessionRef.current.end()
      }
    }
  }, [])

  async function join() {
    setJoining(true)
    try {
      await session.start({ tracks: { microphone: { enabled: true } } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not connect. Check your microphone permissions.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <SessionProvider session={session}>
        {session.isConnected ? (
          <InterviewRoom sessionId={id} title={interview?.title ?? 'Interview'} durationMinutes={interview?.durationMinutes ?? 20} />
        ) : (
          <PreJoin
            sessionId={id}
            title={interview?.title}
            ready={interview?.status === 'READY' || interview?.status === 'IN_PROGRESS'}
            joining={joining || session.connectionState === 'connecting'}
            onJoin={join}
          />
        )}
        <RoomAudioRenderer />
      </SessionProvider>
    </div>
  )
}

function PreJoin({
  sessionId,
  title,
  ready,
  joining,
  onJoin,
}: {
  sessionId: string
  title?: string
  ready: boolean
  joining: boolean
  onJoin: () => void
}) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div className="pointer-events-none absolute top-1/3 left-1/2 size-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" aria-hidden />
      <div className="relative w-full max-w-md text-center">
        <Link
          to={`/app/sessions/${sessionId}`}
          className="mb-10 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to brief
        </Link>
        <div className="mx-auto grid size-20 place-items-center rounded-full bg-primary/15 text-primary">
          <Headphones className="size-8" aria-hidden />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title ?? 'Your interview'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Headphones recommended. Your interviewer will greet you as soon as you join. Pause to think whenever you
          need; it will wait.
        </p>
        <Button size="lg" className="mt-8 h-12 w-full text-base" disabled={!ready || joining} onClick={onJoin}>
          {joining ? <Loader2 className="animate-spin" /> : <Mic />}
          {ready ? (joining ? 'Connecting…' : 'Join interview') : 'Interview not ready'}
        </Button>
      </div>
    </div>
  )
}

const STATE_LABEL: Record<string, string> = {
  connecting: 'Connecting to your interviewer…',
  initializing: 'Your interviewer is joining…',
  'pre-connect-buffering': 'Your interviewer is joining…',
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  failed: 'Interviewer unavailable',
  disconnected: 'Disconnected',
}

function InterviewRoom({ sessionId, title, durationMinutes }: { sessionId: string; title: string; durationMinutes: number }) {
  const navigate = useNavigate()
  const agent = useAgent()
  const { messages } = useSessionMessages()
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  const micDevices = useMediaDeviceSelect({ kind: 'audioinput' })
  const [ending, setEnding] = useState(false)
  const elapsed = useElapsedSeconds()

  const phase = agent.attributes['vettly.phase']
  const qIndex = agent.attributes['vettly.question_index']
  const qTotal = agent.attributes['vettly.question_total']
  const topic = agent.attributes['vettly.topic']

  async function finish() {
    setEnding(true)
    // Closing the room server-side makes the agent flush the transcript and
    // start post-call analysis, even if the goodbye was cut short.
    await api(`/sessions/${sessionId}/end`, { method: 'POST' }).catch(() => {})
    navigate(`/app/sessions/${sessionId}`, { replace: true })
  }

  // The agent ends the call itself after its goodbye.
  useEffect(() => {
    if (phase === 'ended' || agent.isFinished) {
      const t = setTimeout(() => navigate(`/app/sessions/${sessionId}`, { replace: true }), 1500)
      return () => clearTimeout(t)
    }
  }, [phase, agent.isFinished, navigate, sessionId])

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            {phase === 'interview' && qIndex && qTotal ? (
              <>
                Question {qIndex} of {qTotal}
                {topic && <> · {topic}</>}
              </>
            ) : phase === 'closing' ? (
              'Wrapping up'
            ) : (
              'Introduction'
            )}
          </div>
        </div>
        <div className="rounded-full bg-muted px-3 py-1 text-sm tabular-nums" aria-label="Elapsed time">
          {fmt(elapsed)} <span className="text-muted-foreground">/ {durationMinutes}:00</span>
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[1fr_400px]">
        <main className="relative flex flex-col items-center justify-center gap-8 px-4 py-12" data-state={agent.state}>
          <div className="relative grid size-56 place-items-center sm:size-64">
            <div className="orb-glow absolute inset-0 rounded-full bg-primary/30 blur-2xl" aria-hidden />
            <div className="relative grid size-full place-items-center rounded-full border border-primary/30 bg-gradient-to-b from-primary/25 to-primary/5">
              <BarVisualizer
                state={agent.state}
                track={agent.microphoneTrack}
                barCount={5}
                options={{ minHeight: 14 }}
                className="flex h-24 items-center gap-2 [&>span]:w-4 [&>span]:rounded-full [&>span]:bg-primary/40 [&>span]:transition-all [&>span[data-lk-highlighted=true]]:bg-primary"
              />
            </div>
          </div>
          <div className="text-center" aria-live="polite">
            <div className="text-lg font-medium">{STATE_LABEL[agent.state] ?? agent.state}</div>
            {agent.state === 'listening' && (
              <div className="mt-1 text-sm text-muted-foreground">Take your time. Speak when you’re ready.</div>
            )}
            {agent.failureReasons?.length ? (
              <div className="mt-2 text-sm text-destructive">{agent.failureReasons.join(' ')}</div>
            ) : null}
          </div>
          <StartAudio label="Click to enable audio" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" />
        </main>

        <aside className="flex max-h-[45dvh] flex-col border-t lg:max-h-none lg:border-t-0 lg:border-l">
          <div className="border-b px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Live transcript
          </div>
          <TranscriptFeed messages={messages} />
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-3 border-t px-4 py-4">
        <Button
          variant={mic.enabled ? 'secondary' : 'destructive'}
          size="lg"
          className="h-12 rounded-full px-5"
          onClick={() => mic.toggle()}
          disabled={mic.pending}
          aria-pressed={!mic.enabled}
        >
          {mic.enabled ? <Mic /> : <MicOff />} {mic.enabled ? 'Mute' : 'Unmute'}
        </Button>
        {micDevices.devices.length > 0 && (
          <select
            aria-label="Microphone"
            value={micDevices.activeDeviceId}
            onChange={(e) => void micDevices.setActiveMediaDevice(e.target.value)}
            className="h-12 max-w-[220px] truncate rounded-full border bg-secondary px-4 text-sm text-secondary-foreground focus:outline-none"
          >
            {micDevices.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone (${d.deviceId.slice(0, 6)})`}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="destructive"
          size="lg"
          className="h-12 rounded-full bg-destructive px-5 text-white hover:bg-destructive/90"
          disabled={ending}
          onClick={finish}
        >
          {ending ? <Loader2 className="animate-spin" /> : <PhoneOff />} End interview
        </Button>
      </footer>
    </div>
  )
}

function TranscriptFeed({ messages }: { messages: ReturnType<typeof useSessionMessages>['messages'] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])
  const lines = messages.filter((m) => m.type === 'agentTranscript' || m.type === 'userTranscript')

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {lines.length === 0 && <p className="text-sm text-muted-foreground">The conversation will appear here.</p>}
      {lines.map((m) => {
        const isAgent = m.type === 'agentTranscript'
        return (
          <div key={m.id} className={cn('flex', isAgent ? 'justify-start' : 'justify-end')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                isAgent ? 'rounded-bl-sm bg-muted' : 'rounded-br-sm bg-primary text-primary-foreground',
              )}
            >
              {m.message}
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}

function useElapsedSeconds() {
  const [start] = useState(() => Date.now())
  const [now, setNow] = useState(start)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return Math.floor((now - start) / 1000)
}

function fmt(totalSec: number) {
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}
