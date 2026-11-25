import { scoreTone, TONE_TEXT } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Circular 0-100 gauge. The number is the label; the ring is reinforcement. */
export function ScoreRing({
  score,
  size = 120,
  stroke = 10,
  caption,
}: {
  score: number
  size?: number
  stroke?: number
  caption?: string
}) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, score))
  const tone = scoreTone(clamped)

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${Math.round(clamped)} out of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className={cn('stroke-current transition-[stroke-dashoffset] duration-700', TONE_TEXT[tone])}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">{Math.round(clamped)}</div>
          {caption && <div className="text-xs text-muted-foreground">{caption}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * Horizontal 0-10 meter for a scored dimension. One measure, so one hue;
 * the numeric value is always printed beside it in text ink.
 */
export function ScoreBar({ score, max = 10, label }: { score: number; max?: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100))
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={score}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${pct}%` }} />
    </div>
  )
}
