import type { Difficulty, InterviewType, PlannedQuestion, SessionStatus, Verdict } from './types'

export const INTERVIEW_TYPES: Record<InterviewType, { label: string; description: string }> = {
  MIXED: { label: 'Mixed loop', description: 'Resume deep-dive, technical depth and behavioural questions.' },
  TECHNICAL: { label: 'Technical', description: 'Stack knowledge, problem solving and your past engineering work.' },
  BEHAVIORAL: { label: 'Behavioural', description: 'STAR-style questions mapped to the role’s competencies.' },
  SYSTEM_DESIGN: { label: 'System design', description: 'Design a system from the role’s domain; trade-offs and scale.' },
}

export const DIFFICULTIES: Record<Difficulty, { label: string; description: string }> = {
  EASY: { label: 'Warm-up', description: 'Friendly screen with gentle follow-ups.' },
  MEDIUM: { label: 'Realistic', description: 'Onsite level for the role’s seniority.' },
  HARD: { label: 'Bar-raiser', description: 'Pushes on trade-offs, edge cases and impact.' },
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  PREPARING: 'Preparing',
  READY: 'Ready',
  IN_PROGRESS: 'In progress',
  ANALYZING: 'Analysing',
  COMPLETED: 'Completed',
  FAILED: 'Needs attention',
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  strong_hire: 'Strong hire',
  hire: 'Hire',
  lean_hire: 'Lean hire',
  lean_no_hire: 'Lean no hire',
  no_hire: 'No hire',
}

export const CATEGORY_LABEL: Record<PlannedQuestion['category'], string> = {
  intro: 'Intro',
  resume_deep_dive: 'Resume deep-dive',
  technical: 'Technical',
  system_design: 'System design',
  behavioral: 'Behavioural',
  situational: 'Situational',
}

/** Maps a 0-100 score onto the three-step semantic scale used across the UI. */
export function scoreTone(score100: number): 'good' | 'mid' | 'low' {
  if (score100 >= 70) return 'good'
  if (score100 >= 50) return 'mid'
  return 'low'
}

export const TONE_TEXT = { good: 'text-success', mid: 'text-warning', low: 'text-destructive' } as const
export const TONE_BG = { good: 'bg-success', mid: 'bg-warning', low: 'bg-destructive' } as const

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatOffset(sec: number | null) {
  if (sec == null) return ''
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}
