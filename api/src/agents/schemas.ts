import { z } from 'zod';

/**
 * Structured contracts between agents. Each agent returns exactly one of
 * these, validated by LlmService, so downstream agents (and the voice
 * interviewer) can rely on the shape. Descriptions double as instructions
 * to the model in tool-calling mode.
 */

// ─── Resume analyst ──────────────────────────────────────────────────────────

export const resumeProfileSchema = z.object({
  candidateName: z.string().describe('Full name, or empty string if absent'),
  headline: z.string().describe('One-line professional summary in third person'),
  totalYearsExperience: z.number().describe('Best estimate of total professional years'),
  skills: z
    .array(
      z.object({
        name: z.string(),
        category: z.enum(['language', 'framework', 'infrastructure', 'data', 'tool', 'domain', 'soft']),
      }),
    )
    .describe('Distinct skills evidenced in the resume'),
  experiences: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      period: z.string().describe('e.g. "2021 – Present"'),
      highlights: z.array(z.string()).describe('Concrete achievements, metrics preserved verbatim'),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      technologies: z.array(z.string()),
    }),
  ),
  education: z.array(z.string()),
});
export type ResumeProfile = z.infer<typeof resumeProfileSchema>;

// ─── JD analyst ──────────────────────────────────────────────────────────────

export const jobProfileSchema = z.object({
  title: z.string(),
  company: z.string().describe('Company name, or empty string if absent'),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager']),
  domain: z.string().describe('Business/product domain, e.g. "B2B payments"'),
  mustHaveSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  responsibilities: z.array(z.string()),
  competencies: z
    .array(z.string())
    .describe('Behavioural competencies the role demands, e.g. "ownership", "stakeholder management"'),
});
export type JobProfile = z.infer<typeof jobProfileSchema>;

// ─── Fit analyst ─────────────────────────────────────────────────────────────

export const fitAnalysisSchema = z.object({
  matchScore: z.number().describe('0-100 overall fit of the resume to the role'),
  summary: z.string().describe('2-3 sentence assessment written to the candidate ("you")'),
  strengths: z.array(
    z.object({
      requirement: z.string(),
      evidence: z.string().describe('Specific resume evidence that satisfies it'),
    }),
  ),
  gaps: z.array(
    z.object({
      requirement: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
      advice: z.string().describe('How the candidate should address this gap in an interview'),
    }),
  ),
  focusAreas: z.array(z.string()).describe('Topics the interview should probe hardest'),
});
export type FitAnalysis = z.infer<typeof fitAnalysisSchema>;

// ─── Interview planner ───────────────────────────────────────────────────────

export const questionCategorySchema = z.enum([
  'intro',
  'resume_deep_dive',
  'technical',
  'system_design',
  'behavioral',
  'situational',
]);

export const plannedQuestionSchema = z.object({
  id: z.string().describe('Stable id like "q1", "q2"'),
  category: questionCategorySchema,
  topic: z.string().describe('Short label, e.g. "Postgres indexing"'),
  question: z.string().describe('Exactly as the interviewer will say it, conversational, one question'),
  rationale: z.string().describe('Why this question, tied to the JD or a resume gap'),
  followUps: z.array(z.string()).describe('1-3 probing follow-ups'),
  evaluationCriteria: z.array(z.string()).describe('What a strong answer demonstrates'),
  targetMinutes: z.number(),
});
export type PlannedQuestion = z.infer<typeof plannedQuestionSchema>;

export const interviewPlanSchema = z.object({
  interviewerBrief: z
    .string()
    .describe('Private brief for the voice interviewer: role, candidate background, what to probe'),
  questions: z.array(plannedQuestionSchema),
});
export type InterviewPlan = z.infer<typeof interviewPlanSchema>;

// ─── Post-call evaluators ────────────────────────────────────────────────────

export const dimensionScoreSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().describe('0-10'),
  rationale: z.string().describe('Cite what the candidate actually said'),
});
export type DimensionScore = z.infer<typeof dimensionScoreSchema>;

export const evaluatorOutputSchema = z.object({
  dimensions: z.array(dimensionScoreSchema),
  observations: z.array(z.string()).describe('Notable moments, quoting the transcript where useful'),
});
export type EvaluatorOutput = z.infer<typeof evaluatorOutputSchema>;

export const questionReviewSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  answerSummary: z.string(),
  score: z.number().describe('0-10'),
  feedback: z.string().describe('Specific, actionable, written to the candidate'),
  strongerAnswer: z.string().describe('A concise outline of what an excellent answer would include'),
});
export type QuestionReview = z.infer<typeof questionReviewSchema>;

export const questionReviewsSchema = z.object({
  reviews: z.array(questionReviewSchema),
});

export const reportSynthesisSchema = z.object({
  overallScore: z.number().describe('0-100'),
  verdict: z.enum(['strong_hire', 'hire', 'lean_hire', 'lean_no_hire', 'no_hire']),
  summary: z.string().describe('3-5 sentences written to the candidate'),
  strengths: z.array(z.string()),
  improvements: z
    .array(z.object({ area: z.string(), action: z.string().describe('Concrete practice step') }))
    .describe('Prioritised, most impactful first'),
});
export type ReportSynthesis = z.infer<typeof reportSynthesisSchema>;
