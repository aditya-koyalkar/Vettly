import { Module } from '@nestjs/common';
import {
  CommunicationEvaluatorAgent,
  QuestionReviewerAgent,
  ReportSynthesizerAgent,
  TechnicalEvaluatorAgent,
} from './evaluators.agent.js';
import { FitAnalystAgent } from './fit-analyst.agent.js';
import { InterviewPlannerAgent } from './interview-planner.agent.js';
import { JdAnalystAgent } from './jd-analyst.agent.js';
import { ResumeAnalystAgent } from './resume-analyst.agent.js';

/** Stateless LLM agents. Orchestration (graphs) lives with the feature that runs them. */
const agents = [
  ResumeAnalystAgent,
  JdAnalystAgent,
  FitAnalystAgent,
  InterviewPlannerAgent,
  TechnicalEvaluatorAgent,
  CommunicationEvaluatorAgent,
  QuestionReviewerAgent,
  ReportSynthesizerAgent,
];

@Module({
  providers: agents,
  exports: agents,
})
export class AgentsModule {}
