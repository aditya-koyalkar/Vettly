import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { QUEUES, type SessionJob } from '../queues.js';
import type { JobProfile } from '../agents/schemas.js';
import { LiveKitService } from './livekit.service.js';
import type { CreateSession } from './sessions.schemas.js';

const JOINABLE = new Set(['READY', 'IN_PROGRESS']);

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LiveKitService,
    @InjectQueue(QUEUES.sessionPrep) private readonly prepQueue: Queue<SessionJob>,
    @InjectQueue(QUEUES.sessionAnalysis) private readonly analysisQueue: Queue<SessionJob>,
  ) {}

  async create(userId: string, input: CreateSession) {
    const [resume, job] = await Promise.all([
      this.prisma.document.findFirst({ where: { id: input.resumeId, userId, kind: 'RESUME' } }),
      this.prisma.document.findFirst({ where: { id: input.jobDescriptionId, userId, kind: 'JOB_DESCRIPTION' } }),
    ]);
    if (!resume) throw new NotFoundException('Resume not found');
    if (!job) throw new NotFoundException('Job description not found');
    if (resume.status === 'FAILED' || job.status === 'FAILED') {
      throw new BadRequestException('One of the documents failed to process. Re-upload it first.');
    }

    const jobTitle = (job.profile as JobProfile | null)?.title ?? job.title;
    const session = await this.prisma.interviewSession.create({
      data: {
        userId,
        resumeId: resume.id,
        jobDescriptionId: job.id,
        title: input.title || `${jobTitle} practice`,
        type: input.type,
        difficulty: input.difficulty,
        durationMinutes: input.durationMinutes,
      },
    });
    await this.enqueuePrep(session.id);
    return session;
  }

  list(userId: string) {
    return this.prisma.interviewSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        type: true,
        difficulty: true,
        durationMinutes: true,
        status: true,
        createdAt: true,
        startedAt: true,
        endedAt: true,
        resume: { select: { id: true, title: true } },
        jobDescription: { select: { id: true, title: true } },
        report: { select: { overallScore: true, verdict: true } },
      },
    });
  }

  async get(userId: string, id: string) {
    const session = await this.prisma.interviewSession.findFirst({
      where: { id, userId },
      include: {
        resume: { select: { id: true, title: true } },
        jobDescription: { select: { id: true, title: true, profile: true } },
        turns: { orderBy: { sequence: 'asc' } },
        notes: { orderBy: { createdAt: 'asc' } },
        report: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async remove(userId: string, id: string) {
    const session = await this.get(userId, id);
    if (session.roomName && session.status === 'IN_PROGRESS') await this.livekit.closeRoom(session.roomName);
    await this.prisma.interviewSession.delete({ where: { id } });
  }

  /** Re-runs whichever pipeline stage failed. */
  async retry(userId: string, id: string) {
    const session = await this.get(userId, id);
    if (session.status !== 'FAILED') throw new ConflictException('Only failed sessions can be retried');
    const analysisStage = session.turns.length > 0;
    await this.prisma.interviewSession.update({
      where: { id },
      data: { status: analysisStage ? 'ANALYZING' : 'PREPARING', error: null },
    });
    if (analysisStage) await this.enqueueAnalysis(id);
    else await this.enqueuePrep(id);
  }

  async join(userId: string, userName: string, id: string) {
    const session = await this.get(userId, id);
    if (!JOINABLE.has(session.status)) {
      throw new ConflictException(
        session.status === 'PREPARING' ? 'Your interview is still being prepared' : 'This interview has already ended',
      );
    }
    // Stable per session so a page refresh rejoins the same room and agent.
    const roomName = session.roomName ?? `vettly-${session.id}`;
    if (!session.roomName) {
      await this.prisma.interviewSession.update({ where: { id }, data: { roomName } });
    }
    return this.livekit.createCandidateToken({ roomName, sessionId: id, userId, userName });
  }

  /** Candidate hung up. Closing the room makes the agent flush its transcript. */
  async end(userId: string, id: string) {
    const session = await this.get(userId, id);
    if (session.roomName) await this.livekit.closeRoom(session.roomName);
    return { status: session.status };
  }

  enqueuePrep(sessionId: string) {
    return this.prepQueue.add('prep', { sessionId }, { jobId: `prep-${sessionId}-${Date.now()}` });
  }

  enqueueAnalysis(sessionId: string) {
    return this.analysisQueue.add('analyze', { sessionId }, { jobId: `analysis-${sessionId}-${Date.now()}` });
  }
}
