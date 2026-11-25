import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RetrievalService } from '../../documents/retrieval.service.js';
import type { FitAnalysis, InterviewPlan, JobProfile, ResumeProfile } from '../../agents/schemas.js';
import { SessionsService } from '../sessions.service.js';
import type { AgentComplete, AgentNote, AgentSearch } from '../sessions.schemas.js';

/** Everything the voice agent needs to run one interview, in one payload. */
export interface InterviewContext {
  sessionId: string;
  candidateName: string;
  jobTitle: string;
  company: string;
  type: string;
  difficulty: string;
  durationMinutes: number;
  interviewerBrief: string;
  focusAreas: string[];
  questions: InterviewPlan['questions'];
}

/** Backs the internal API the LiveKit agent calls during an interview. */
@Injectable()
export class InterviewRuntimeService {
  private readonly logger = new Logger(InterviewRuntimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly sessions: SessionsService,
  ) {}

  async context(sessionId: string): Promise<InterviewContext> {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { user: true, resume: true, jobDescription: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'READY' && session.status !== 'IN_PROGRESS') {
      throw new ConflictException(`Session is ${session.status}`);
    }
    if (session.status === 'READY') {
      await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
    }

    const plan = session.plan as InterviewPlan;
    const fit = session.fitAnalysis as FitAnalysis;
    const job = session.jobDescription.profile as JobProfile;
    const resume = session.resume.profile as ResumeProfile;
    return {
      sessionId,
      candidateName: (resume.candidateName || session.user.name).split(' ')[0],
      jobTitle: job.title,
      company: job.company,
      type: session.type,
      difficulty: session.difficulty,
      durationMinutes: session.durationMinutes,
      interviewerBrief: plan.interviewerBrief,
      focusAreas: fit.focusAreas,
      questions: plan.questions,
    };
  }

  async search(sessionId: string, input: AgentSearch) {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    const documentIds =
      input.scope === 'resume'
        ? [session.resumeId]
        : input.scope === 'job'
          ? [session.jobDescriptionId]
          : [session.resumeId, session.jobDescriptionId];
    const hits = await this.retrieval.search(input.query, { documentIds, limit: 4 });
    return hits.map((h) => ({ source: h.kind, section: h.section, content: h.content }));
  }

  async addNote(sessionId: string, note: AgentNote) {
    await this.prisma.interviewNote.create({ data: { sessionId, ...note } });
    return { ok: true };
  }

  /**
   * Persists the transcript and hands off to post-call analysis. Idempotent:
   * the agent may call this on both normal close and shutdown.
   */
  async complete(sessionId: string, input: AgentComplete) {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'IN_PROGRESS') return { status: session.status };

    const turns = input.turns.filter((t) => t.content.trim());
    const candidateSpoke = turns.some((t) => t.role === 'CANDIDATE');

    await this.prisma.$transaction([
      this.prisma.transcriptTurn.deleteMany({ where: { sessionId } }),
      this.prisma.transcriptTurn.createMany({
        data: turns.map((t, sequence) => ({ sessionId, sequence, ...t })),
      }),
      this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: candidateSpoke
          ? { status: 'ANALYZING', endedAt: new Date() }
          : // Nothing to grade: let the candidate start again instead of failing.
            { status: 'READY', startedAt: null, roomName: null },
      }),
    ]);

    if (candidateSpoke) await this.sessions.enqueueAnalysis(sessionId);
    this.logger.log(`Session ${sessionId} ended (${input.endedReason ?? 'unknown'}), ${turns.length} turns`);
    return { status: candidateSpoke ? 'ANALYZING' : 'READY' };
  }
}
