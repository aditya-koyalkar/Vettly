import { Injectable } from '@nestjs/common';
import type { Difficulty, InterviewType } from '@prisma/client';
import { LlmService, type StructuredResult } from '../llm/llm.service.js';
import { DATA_GUARD, asData } from './prompt-utils.js';
import {
  interviewPlanSchema,
  type FitAnalysis,
  type InterviewPlan,
  type JobProfile,
  type ResumeProfile,
} from './schemas.js';

const TYPE_GUIDANCE: Record<InterviewType, string> = {
  TECHNICAL: 'Mostly technical depth and resume deep-dives on the stack the role uses; one behavioural question at most.',
  BEHAVIORAL: 'Behavioural and situational questions mapped to the role competencies; expect STAR-structured answers.',
  SYSTEM_DESIGN: 'One or two design problems relevant to the role domain, with follow-ups on trade-offs, scale and failure modes.',
  MIXED: 'A balanced loop: resume deep-dive, technical depth, and behavioural questions.',
};

const DIFFICULTY_GUIDANCE: Record<Difficulty, string> = {
  EASY: 'Friendly screening level. Fundamentals, open questions, gentle follow-ups.',
  MEDIUM: 'Realistic onsite level for the seniority. Expect specifics and probe vague answers once.',
  HARD: 'Bar-raiser level. Push on trade-offs, edge cases, and quantified impact; challenge weak claims.',
};

/** Designs the question plan the voice interviewer will follow. */
@Injectable()
export class InterviewPlannerAgent {
  constructor(private readonly llm: LlmService) {}

  run(input: {
    resume: ResumeProfile;
    job: JobProfile;
    fit: FitAnalysis;
    type: InterviewType;
    difficulty: Difficulty;
    durationMinutes: number;
  }): Promise<StructuredResult<InterviewPlan>> {
    // ~1 question per 3-4 minutes, leaving time for intro and wrap-up.
    const questionCount = Math.max(3, Math.min(12, Math.round((input.durationMinutes - 3) / 3.5)));

    return this.llm.structured(
      interviewPlanSchema,
      [
        {
          role: 'system',
          content: [
            'You are a principal interviewer designing a realistic mock interview for practice.',
            `Interview format: ${TYPE_GUIDANCE[input.type]}`,
            `Difficulty: ${DIFFICULTY_GUIDANCE[input.difficulty]}`,
            `Plan exactly ${questionCount} questions for a ${input.durationMinutes}-minute voice interview. The first is a short "intro" question.`,
            'Target the focus areas and gaps from the fit analysis; reference specific resume projects by name.',
            'Questions are spoken aloud: one question each, natural phrasing, no lists, no code blocks, under 40 words.',
            'targetMinutes across questions should sum to roughly the interview duration minus 2 minutes.',
            DATA_GUARD,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            asData('job_profile', JSON.stringify(input.job)),
            asData('candidate_profile', JSON.stringify(input.resume)),
            asData('fit_analysis', JSON.stringify(input.fit)),
          ].join('\n\n'),
        },
      ],
      { name: 'interview_plan', temperature: 0.5 },
    );
  }
}
