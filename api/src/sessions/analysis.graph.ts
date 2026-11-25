import { Injectable } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  CommunicationEvaluatorAgent,
  QuestionReviewerAgent,
  ReportSynthesizerAgent,
  TechnicalEvaluatorAgent,
  type EvaluationInput,
} from '../agents/evaluators.agent.js';
import type {
  EvaluatorOutput,
  FitAnalysis,
  InterviewPlan,
  JobProfile,
  QuestionReview,
  ReportSynthesis,
} from '../agents/schemas.js';

const concat = <T>(a: T[], b: T[]) => a.concat(b);

const AnalysisState = Annotation.Root({
  transcript: Annotation<string>,
  notes: Annotation<string>,
  job: Annotation<JobProfile>,
  plan: Annotation<InterviewPlan>,
  fit: Annotation<FitAnalysis>,
  evaluations: Annotation<EvaluatorOutput[]>({ reducer: concat, default: () => [] }),
  reviews: Annotation<QuestionReview[]>,
  synthesis: Annotation<ReportSynthesis>,
  models: Annotation<string[]>({ reducer: concat, default: () => [] }),
});
type AnalysisStateT = typeof AnalysisState.State;
export type AnalysisInput = Pick<AnalysisStateT, 'transcript' | 'notes' | 'job' | 'plan' | 'fit'>;
export type AnalysisOutput = Pick<AnalysisStateT, 'evaluations' | 'reviews' | 'synthesis' | 'models'>;

/**
 * Post-call analysis, orchestrated as a LangGraph:
 *
 *          ┌─▶ technicalEvaluator ──────┐
 *   START ─┼─▶ communicationEvaluator ──┼─▶ synthesizer ─▶ END
 *          └─▶ questionReviewer ────────┘
 *
 * The three evaluators are independent specialists running in parallel; the
 * synthesizer waits for all of them (LangGraph joins on the shared superstep).
 */
@Injectable()
export class AnalysisGraph {
  private readonly graph;

  constructor(
    private readonly technical: TechnicalEvaluatorAgent,
    private readonly communication: CommunicationEvaluatorAgent,
    private readonly reviewer: QuestionReviewerAgent,
    private readonly synthesizer: ReportSynthesizerAgent,
  ) {
    this.graph = new StateGraph(AnalysisState)
      .addNode('technicalEvaluator', async (s: AnalysisStateT) => {
        const { data, model } = await this.technical.run(toInput(s));
        return { evaluations: [data], models: [`technical:${model}`] };
      })
      .addNode('communicationEvaluator', async (s: AnalysisStateT) => {
        const { data, model } = await this.communication.run(toInput(s));
        return { evaluations: [data], models: [`communication:${model}`] };
      })
      .addNode('questionReviewer', async (s: AnalysisStateT) => {
        const { data, model } = await this.reviewer.run(toInput(s));
        return { reviews: data, models: [`reviewer:${model}`] };
      })
      .addNode('synthesizer', async (s: AnalysisStateT) => {
        const { data, model } = await this.synthesizer.run({
          job: s.job,
          fit: s.fit,
          evaluations: s.evaluations,
          reviews: s.reviews,
        });
        return { synthesis: data, models: [`synthesizer:${model}`] };
      })
      .addEdge(START, 'technicalEvaluator')
      .addEdge(START, 'communicationEvaluator')
      .addEdge(START, 'questionReviewer')
      .addEdge(['technicalEvaluator', 'communicationEvaluator', 'questionReviewer'], 'synthesizer')
      .addEdge('synthesizer', END)
      .compile();
  }

  async run(input: AnalysisInput): Promise<AnalysisOutput> {
    const result = await this.graph.invoke(input);
    return {
      evaluations: result.evaluations,
      reviews: result.reviews,
      synthesis: result.synthesis,
      models: result.models,
    };
  }
}

function toInput(s: AnalysisStateT): EvaluationInput {
  return { transcript: s.transcript, job: s.job, plan: s.plan, notes: s.notes };
}
