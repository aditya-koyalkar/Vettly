import { Injectable } from '@nestjs/common';
import { Annotation, END, START, Send, StateGraph } from '@langchain/langgraph';
import type { Difficulty, InterviewType } from '@prisma/client';
import { FitAnalystAgent, type RequirementEvidence } from '../agents/fit-analyst.agent.js';
import { InterviewPlannerAgent } from '../agents/interview-planner.agent.js';
import type { FitAnalysis, InterviewPlan, JobProfile, ResumeProfile } from '../agents/schemas.js';
import { RetrievalService } from '../documents/retrieval.service.js';

const concat = <T>(a: T[], b: T[]) => a.concat(b);

const PrepState = Annotation.Root({
  resumeDocumentId: Annotation<string>,
  resume: Annotation<ResumeProfile>,
  job: Annotation<JobProfile>,
  type: Annotation<InterviewType>,
  difficulty: Annotation<Difficulty>,
  durationMinutes: Annotation<number>,
  /** Set only on the per-requirement branches created by Send. */
  requirement: Annotation<string>,
  evidence: Annotation<RequirementEvidence[]>({ reducer: concat, default: () => [] }),
  fit: Annotation<FitAnalysis>,
  plan: Annotation<InterviewPlan>,
  /** Which provider served each agent, for traceability. */
  models: Annotation<string[]>({ reducer: concat, default: () => [] }),
});
type PrepStateT = typeof PrepState.State;
export type PrepInput = Pick<PrepStateT, 'resumeDocumentId' | 'resume' | 'job' | 'type' | 'difficulty' | 'durationMinutes'>;
export type PrepOutput = Pick<PrepStateT, 'fit' | 'plan' | 'models'>;

/** Requirements worth grounding with resume evidence, most important first. */
function requirementsToProbe(job: JobProfile): string[] {
  return [...new Set([...job.mustHaveSkills.slice(0, 8), ...job.responsibilities.slice(0, 3), ...job.competencies.slice(0, 3)])];
}

/**
 * Session preparation, orchestrated as a LangGraph:
 *
 *   START ──Send×N──▶ retrieveEvidence (RAG, parallel per requirement)
 *                          │ (evidence reduced)
 *                          ▼
 *                      fitAnalyst ──▶ interviewPlanner ──▶ END
 */
@Injectable()
export class PrepGraph {
  private readonly graph;

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly fitAnalyst: FitAnalystAgent,
    private readonly planner: InterviewPlannerAgent,
  ) {
    this.graph = new StateGraph(PrepState)
      .addNode('retrieveEvidence', (s: PrepStateT) => this.retrieveEvidence(s))
      .addNode('fitAnalyst', (s: PrepStateT) => this.analyseFit(s))
      .addNode('interviewPlanner', (s: PrepStateT) => this.plan(s))
      .addConditionalEdges(START, (s: PrepStateT) => this.fanOut(s), ['retrieveEvidence', 'fitAnalyst'])
      .addEdge('retrieveEvidence', 'fitAnalyst')
      .addEdge('fitAnalyst', 'interviewPlanner')
      .addEdge('interviewPlanner', END)
      .compile();
  }

  async run(input: PrepInput): Promise<PrepOutput> {
    const result = await this.graph.invoke(input);
    return { fit: result.fit, plan: result.plan, models: result.models };
  }

  private fanOut(state: PrepStateT): Send[] | 'fitAnalyst' {
    const requirements = requirementsToProbe(state.job);
    if (requirements.length === 0) return 'fitAnalyst';
    return requirements.map((requirement) => new Send('retrieveEvidence', { ...state, requirement }));
  }

  private async retrieveEvidence(state: PrepStateT): Promise<Partial<PrepStateT>> {
    const hits = await this.retrieval.search(state.requirement, {
      documentIds: [state.resumeDocumentId],
      limit: 2,
    });
    return { evidence: [{ requirement: state.requirement, excerpts: hits.map((h) => h.content.slice(0, 500)) }] };
  }

  private async analyseFit(state: PrepStateT): Promise<Partial<PrepStateT>> {
    const { data, model } = await this.fitAnalyst.run({
      resume: state.resume,
      job: state.job,
      evidence: state.evidence,
    });
    return { fit: data, models: [`fit:${model}`] };
  }

  private async plan(state: PrepStateT): Promise<Partial<PrepStateT>> {
    const { data, model } = await this.planner.run({
      resume: state.resume,
      job: state.job,
      fit: state.fit,
      type: state.type,
      difficulty: state.difficulty,
      durationMinutes: state.durationMinutes,
    });
    // Normalise ids so the voice agent and the report can reference them reliably.
    const questions = data.questions.map((q, i) => ({ ...q, id: `q${i + 1}` }));
    return { plan: { ...data, questions }, models: [`planner:${model}`] };
  }
}
