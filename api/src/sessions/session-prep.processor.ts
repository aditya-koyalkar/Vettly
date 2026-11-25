import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { QUEUES, type SessionJob } from '../queues.js';
import type { JobProfile, ResumeProfile } from '../agents/schemas.js';
import { PrepGraph } from './prep.graph.js';

const DOCUMENT_POLL_MS = 3_000;

@Processor(QUEUES.sessionPrep, { concurrency: 2 })
export class SessionPrepProcessor extends WorkerHost {
  private readonly logger = new Logger(SessionPrepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prepGraph: PrepGraph,
  ) {
    super();
  }

  async process(job: Job<SessionJob>, token?: string) {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: job.data.sessionId },
      include: { resume: true, jobDescription: true },
    });
    if (!session || session.status !== 'PREPARING') return;

    // Users can start a session right after uploading; wait for ingest to finish
    // without burning a retry attempt.
    if (session.resume.status === 'PROCESSING' || session.jobDescription.status === 'PROCESSING') {
      await job.moveToDelayed(Date.now() + DOCUMENT_POLL_MS, token);
      throw new DelayedError();
    }
    if (!session.resume.profile || !session.jobDescription.profile) {
      throw new Error('Documents finished processing without a profile');
    }

    const { fit, plan, models } = await this.prepGraph.run({
      resumeDocumentId: session.resumeId,
      resume: session.resume.profile as ResumeProfile,
      job: session.jobDescription.profile as JobProfile,
      type: session.type,
      difficulty: session.difficulty,
      durationMinutes: session.durationMinutes,
    });

    await this.prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: 'READY', fitAnalysis: fit, plan, error: null },
    });
    this.logger.log(`Session ${session.id} ready (${plan.questions.length} questions; ${models.join(', ')})`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<SessionJob>, error: Error) {
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await this.prisma.interviewSession.update({
      where: { id: job.data.sessionId },
      data: { status: 'FAILED', error: 'We could not prepare this interview. Please retry.' },
    });
    this.logger.error(`Prep failed for ${job.data.sessionId}: ${error.message}`);
  }
}
