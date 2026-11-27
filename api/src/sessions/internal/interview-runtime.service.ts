import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
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
  keyterms: string[];
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
    private readonly config: ConfigService<Env, true>,
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
    const keyterms = this.extractKeyterms(job, resume);
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
      keyterms,
      questions: plan.questions,
    };
  }

  private extractKeyterms(job: JobProfile, resume: ResumeProfile): string[] {
    const terms: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string | undefined) => {
      if (!raw) return;
      const term = raw.trim().replace(/^[.,:;!?()[\]{}"'\s]+|[.,:;!?()[\]{}"'\s]+$/g, '');
      if (!term || term.length > 40 || terms.length >= 50) return;
      const key = term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      terms.push(term);
    };

    for (const s of job.mustHaveSkills ?? []) add(s);
    for (const s of job.niceToHaveSkills ?? []) add(s);
    for (const s of resume.skills ?? []) add(s.name);
    for (const p of resume.projects ?? []) {
      add(p.name);
      for (const t of p.technologies ?? []) add(t);
    }
    for (const e of resume.experiences ?? []) add(e.company);
    add(job.domain);
    for (const c of job.competencies ?? []) add(c);

    // Pull technical/proper-noun tokens (e.g. LiveKit, Twilio, YAML, ADK, CI/CD) from highlights.
    const techRe = /\b(?:[A-Z][A-Za-z0-9.+#-]{1,}|[a-z]+[A-Z][A-Za-z0-9]*)\b/g;
    const textSources = [
      ...(resume.experiences ?? []).flatMap((e) => e.highlights ?? []),
      ...(resume.projects ?? []).map((p) => p.summary),
      ...(job.responsibilities ?? []),
    ];
    for (const text of textSources) {
      for (const match of text.match(techRe) ?? []) {
        for (const part of match.split('/')) add(part);
      }
    }
    return terms;
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
    const skipAnalysis = this.config.get('SKIP_POST_CALL_ANALYSIS', { infer: true });
    const nextStatus = !candidateSpoke ? 'READY' : skipAnalysis ? 'COMPLETED' : 'ANALYZING';

    await this.prisma.$transaction([
      this.prisma.transcriptTurn.deleteMany({ where: { sessionId } }),
      this.prisma.transcriptTurn.createMany({
        data: turns.map((t, sequence) => ({ sessionId, sequence, ...t })),
      }),
      this.prisma.interviewSession.update({
        where: { id: sessionId },
        data:
          nextStatus === 'READY'
            ? // Nothing to grade: let the candidate start again instead of failing.
              { status: 'READY', startedAt: null, roomName: null }
            : { status: nextStatus, endedAt: new Date(), error: null },
      }),
    ]);

    if (nextStatus === 'ANALYZING') await this.sessions.enqueueAnalysis(sessionId);
    this.logger.log(`Session ${sessionId} ended (${input.endedReason ?? 'unknown'}), ${turns.length} turns`);
    return { status: nextStatus };
  }
}
