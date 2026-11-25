import { Injectable } from '@nestjs/common';
import { LlmService, type StructuredResult } from '../llm/llm.service.js';
import { DATA_GUARD, asData } from './prompt-utils.js';
import {
  evaluatorOutputSchema,
  questionReviewsSchema,
  reportSynthesisSchema,
  type EvaluatorOutput,
  type FitAnalysis,
  type InterviewPlan,
  type JobProfile,
  type QuestionReview,
  type ReportSynthesis,
} from './schemas.js';

export interface EvaluationInput {
  transcript: string;
  job: JobProfile;
  plan: InterviewPlan;
  /** Live observations the interviewer recorded via tool calls. */
  notes: string;
}

const SCORING_RUBRIC =
  'Score 0-10: 0-3 weak/absent, 4-5 below bar, 6-7 meets bar for the seniority, 8-9 strong, 10 exceptional. ' +
  'Judge only what the candidate said in the transcript; silence or "I don\'t know" scores low. Address the candidate as "you".';

/** Rates technical depth and problem solving against the role. */
@Injectable()
export class TechnicalEvaluatorAgent {
  constructor(private readonly llm: LlmService) {}

  run(input: EvaluationInput): Promise<StructuredResult<EvaluatorOutput>> {
    return this.llm.structured(
      evaluatorOutputSchema,
      [
        {
          role: 'system',
          content: [
            `You are a senior ${input.job.title} interviewer grading a mock interview for technical merit.`,
            'Return exactly these dimensions (key: label): technical_depth: Technical depth, problem_solving: Problem solving, role_relevance: Role relevance.',
            SCORING_RUBRIC,
            DATA_GUARD,
          ].join('\n'),
        },
        { role: 'user', content: evaluationContext(input) },
      ],
      { name: 'technical_evaluation', temperature: 0.1 },
    );
  }
}

/** Rates how the candidate communicated, independent of correctness. */
@Injectable()
export class CommunicationEvaluatorAgent {
  constructor(private readonly llm: LlmService) {}

  run(input: EvaluationInput): Promise<StructuredResult<EvaluatorOutput>> {
    return this.llm.structured(
      evaluatorOutputSchema,
      [
        {
          role: 'system',
          content: [
            'You are an interview communication coach grading a spoken mock interview transcript.',
            'Return exactly these dimensions (key: label): clarity: Clarity, structure: Answer structure (STAR for behavioural), conciseness: Conciseness, confidence: Confidence & ownership.',
            'The transcript comes from speech-to-text: ignore transcription errors and filler words unless they dominate.',
            SCORING_RUBRIC,
            DATA_GUARD,
          ].join('\n'),
        },
        { role: 'user', content: evaluationContext(input) },
      ],
      { name: 'communication_evaluation', temperature: 0.1 },
    );
  }
}

/** Reviews each planned question that was actually asked. */
@Injectable()
export class QuestionReviewerAgent {
  constructor(private readonly llm: LlmService) {}

  async run(input: EvaluationInput): Promise<StructuredResult<QuestionReview[]>> {
    const { data, model } = await this.llm.structured(
      questionReviewsSchema,
      [
        {
          role: 'system',
          content: [
            'You review a mock interview question by question.',
            'For every planned question that was actually asked (even if paraphrased), produce one review using the plan question id.',
            'Skip questions that were never asked. Include significant unplanned questions with id "extra".',
            'strongerAnswer must be specific to this candidate and role, not generic advice.',
            SCORING_RUBRIC,
            DATA_GUARD,
          ].join('\n'),
        },
        { role: 'user', content: evaluationContext(input) },
      ],
      { name: 'question_reviews', temperature: 0.2 },
    );
    return { data: data.reviews, model };
  }
}

/** Merges evaluator outputs into the final candidate-facing verdict. */
@Injectable()
export class ReportSynthesizerAgent {
  constructor(private readonly llm: LlmService) {}

  run(input: {
    job: JobProfile;
    fit: FitAnalysis;
    evaluations: EvaluatorOutput[];
    reviews: QuestionReview[];
  }): Promise<StructuredResult<ReportSynthesis>> {
    return this.llm.structured(
      reportSynthesisSchema,
      [
        {
          role: 'system',
          content: [
            'You are the hiring committee chair writing the debrief for a mock interview, addressed to the candidate.',
            'Base the verdict on the evaluators\' evidence, weighted toward technical dimensions for technical roles.',
            'overallScore (0-100) must be consistent with the dimension scores. Be honest but encouraging.',
            'improvements must be concrete practice actions, ordered by impact, at most 5.',
            DATA_GUARD,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            asData('job_profile', JSON.stringify(input.job)),
            asData('pre_interview_fit', JSON.stringify({ matchScore: input.fit.matchScore, gaps: input.fit.gaps })),
            asData('evaluator_outputs', JSON.stringify(input.evaluations)),
            asData('question_reviews', JSON.stringify(input.reviews)),
          ].join('\n\n'),
        },
      ],
      { name: 'report_synthesis', temperature: 0.3 },
    );
  }
}

function evaluationContext(input: EvaluationInput): string {
  const plan = input.plan.questions.map((q) => ({
    id: q.id,
    category: q.category,
    question: q.question,
    evaluationCriteria: q.evaluationCriteria,
  }));
  return [
    asData('job_profile', JSON.stringify(input.job)),
    asData('interview_plan', JSON.stringify(plan)),
    asData('interviewer_live_notes', input.notes || '(none)'),
    asData('transcript', input.transcript),
  ].join('\n\n');
}
