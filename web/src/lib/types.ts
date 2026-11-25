// Mirrors the API's response shapes (api/src). Keep in sync with agents/schemas.ts.

export interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export interface Tokens {
  accessToken: string
  refreshToken: string
}

export type DocumentKind = 'RESUME' | 'JOB_DESCRIPTION'
export type DocumentStatus = 'PROCESSING' | 'READY' | 'FAILED'

export interface ResumeProfile {
  candidateName: string
  headline: string
  totalYearsExperience: number
  skills: { name: string; category: string }[]
  experiences: { company: string; role: string; period: string; highlights: string[] }[]
  projects: { name: string; summary: string; technologies: string[] }[]
  education: string[]
}

export interface JobProfile {
  title: string
  company: string
  seniority: string
  domain: string
  mustHaveSkills: string[]
  niceToHaveSkills: string[]
  responsibilities: string[]
  competencies: string[]
}

export interface VettlyDocument {
  id: string
  kind: DocumentKind
  title: string
  fileName: string | null
  status: DocumentStatus
  error: string | null
  profile: ResumeProfile | JobProfile | null
  createdAt: string
  _count: { chunks: number }
}

export type InterviewType = 'TECHNICAL' | 'BEHAVIORAL' | 'SYSTEM_DESIGN' | 'MIXED'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'
export type SessionStatus = 'PREPARING' | 'READY' | 'IN_PROGRESS' | 'ANALYZING' | 'COMPLETED' | 'FAILED'
export type Verdict = 'strong_hire' | 'hire' | 'lean_hire' | 'lean_no_hire' | 'no_hire'

export interface FitAnalysis {
  matchScore: number
  summary: string
  strengths: { requirement: string; evidence: string }[]
  gaps: { requirement: string; severity: 'low' | 'medium' | 'high'; advice: string }[]
  focusAreas: string[]
}

export interface PlannedQuestion {
  id: string
  category: 'intro' | 'resume_deep_dive' | 'technical' | 'system_design' | 'behavioral' | 'situational'
  topic: string
  question: string
  rationale: string
  followUps: string[]
  evaluationCriteria: string[]
  targetMinutes: number
}

export interface InterviewPlan {
  interviewerBrief: string
  questions: PlannedQuestion[]
}

export interface DimensionScore {
  key: string
  label: string
  score: number
  rationale: string
}

export interface QuestionReview {
  questionId: string
  question: string
  answerSummary: string
  score: number
  feedback: string
  strongerAnswer: string
}

export interface InterviewReport {
  overallScore: number
  verdict: Verdict
  summary: string
  dimensions: DimensionScore[]
  questionReviews: QuestionReview[]
  strengths: string[]
  improvements: { area: string; action: string }[]
  model: string | null
  createdAt: string
}

export interface TranscriptTurn {
  id: string
  sequence: number
  role: 'AGENT' | 'CANDIDATE'
  content: string
  offsetSec: number | null
}

export interface SessionSummary {
  id: string
  title: string
  type: InterviewType
  difficulty: Difficulty
  durationMinutes: number
  status: SessionStatus
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  resume: { id: string; title: string }
  jobDescription: { id: string; title: string }
  report: { overallScore: number; verdict: Verdict } | null
}

export interface SessionDetail extends Omit<SessionSummary, 'report' | 'jobDescription'> {
  error: string | null
  fitAnalysis: FitAnalysis | null
  plan: InterviewPlan | null
  jobDescription: { id: string; title: string; profile: JobProfile | null }
  turns: TranscriptTurn[]
  report: InterviewReport | null
}

export interface RoomCredentials {
  serverUrl: string
  roomName: string
  token: string
}
