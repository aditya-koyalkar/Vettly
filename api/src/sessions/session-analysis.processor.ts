import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { TranscriptTurn } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QUEUES, type SessionJob } from '../queues.js';
import type { FitAnalysis, InterviewPlan, JobProfile } from '../agents/schemas.js';
import { AnalysisGraph } from './analysis.graph.js';

/** Keeps long interviews inside a free-tier context window. */
const MAX_TRANSCRIPT_CHARS = 60_000;

export function formatTranscript(turns: Pick<TranscriptTurn, 'role' | 'content' | 'offsetSec'>[]): string {
  const lines = turns.map((t) => {
    const stamp =
      t.offsetSec != null
        ? `[${String(Math.floor(t.offsetSec / 60)).padStart(2, '0')}:${String(Math.floor(t.offsetSec % 60)).padStart(2, '0')}] `
        : '';
    return `${stamp}${t.role === 'AGENT' ? 'Interviewer' : 'Candidate'}: ${t.content.trim()}`;
  });
  const text = lines.join('\n');
  return text.length <= MAX_TRANSCRIPT_CHARS ? text : `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n[...transcript truncated]`;
}

@Processor(QUEUES.sessionAnalysis, { concurrency: 2 })
export class SessionAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(SessionAnalysisProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisGraph: AnalysisGraph,
  ) {
    super();
  }

  async process(job: Job<SessionJob>) {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: job.data.sessionId },
      include: {
        jobDescription: true,
        turns: { orderBy: { sequence: 'asc' } },
        notes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session || session.status !== 'ANALYZING') return;

    const { evaluations, reviews, synthesis, models } = await this.analysisGraph.run({
      transcript: formatTranscript(session.turns),
      notes: session.notes
        .map((n) => `- [${n.questionId ?? n.topic}] ${n.observation}${n.rating ? ` (rating ${n.rating}/5)` : ''}`)
        .join('\n'),
      job: session.jobDescription.profile as JobProfile,
      plan: session.plan as InterviewPlan,
      fit: session.fitAnalysis as FitAnalysis,
    });

    const report = {
      overallScore: clamp(synthesis.overallScore, 0, 100),
      verdict: synthesis.verdict,
      summary: synthesis.summary,
      dimensions: evaluations.flatMap((e) => e.dimensions.map((d) => ({ ...d, score: clamp(d.score, 0, 10) }))),
      questionReviews: reviews.map((r) => ({ ...r, score: clamp(r.score, 0, 10) })),
      strengths: synthesis.strengths,
      improvements: synthesis.improvements,
      model: models.join(', '),
    };

    await this.prisma.$transaction([
      this.prisma.interviewReport.upsert({
        where: { sessionId: session.id },
        create: { sessionId: session.id, ...report },
        update: report,
      }),
      this.prisma.interviewSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', error: null },
      }),
    ]);
    this.logger.log(`Report ready for ${session.id}: ${report.overallScore} (${report.verdict})`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<SessionJob>, error: Error) {
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await this.prisma.interviewSession.update({
      where: { id: job.data.sessionId },
      data: { status: 'FAILED', error: 'Your interview was saved, but analysis failed. Please retry.' },
    });
    this.logger.error(`Analysis failed for ${job.data.sessionId}: ${error.message}`);
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}
