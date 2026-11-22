import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { CompleteInterviewDto } from './dto/complete-interview.dto.js';

@Injectable()
export class InterviewsService {
  private readonly logger = new Logger(InterviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Public check when candidate opens the unique URL.
   * Validates token existence, expiration, and completion status.
   */
  async verifyInterviewToken(token: string) {
    const tokenHash = this.hashToken(token);

    const interview = await this.prisma.interview.findUnique({
      where: { tokenHash },
      include: {
        candidate: {
          include: {
            job: {
              include: {
                _count: { select: { questions: true } },
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new NotFoundException('Invalid or unknown interview link.');
    }

    if (interview.status === 'COMPLETED') {
      return {
        status: 'COMPLETED',
        message: 'This interview has already been completed and submitted.',
        candidateName: interview.candidate.name,
        jobTitle: interview.candidate.job.title,
      };
    }

    if (new Date() > interview.expiresAt) {
      await this.prisma.interview.update({
        where: { id: interview.id },
        data: { status: 'EXPIRED' },
      });
      await this.prisma.candidate.update({
        where: { id: interview.candidateId },
        data: { status: 'EXPIRED' },
      });

      return {
        status: 'EXPIRED',
        message: 'This interview link has expired. Please contact the recruiter for a new invitation.',
        candidateName: interview.candidate.name,
        jobTitle: interview.candidate.job.title,
      };
    }

    return {
      status: 'READY',
      interviewId: interview.id,
      candidateName: interview.candidate.name || 'Candidate',
      candidateEmail: interview.candidate.email,
      jobTitle: interview.candidate.job.title,
      jobDescription: interview.candidate.job.description,
      totalQuestions: interview.candidate.job._count.questions,
      maxDurationMinutes: 10,
    };
  }

  /**
   * Public endpoint when candidate confirms starting the session.
   * Generates a signed LiveKit participant token with room metadata.
   */
  async startInterviewSession(token: string) {
    const tokenHash = this.hashToken(token);

    const interview = await this.prisma.interview.findUnique({
      where: { tokenHash },
      include: {
        candidate: {
          include: {
            job: {
              include: {
                questions: { orderBy: { order: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new NotFoundException('Invalid interview link.');
    }

    if (interview.status === 'COMPLETED') {
      throw new BadRequestException('This interview has already been completed.');
    }

    if (new Date() > interview.expiresAt) {
      throw new BadRequestException('This interview link has expired.');
    }

    const now = new Date();
    await this.prisma.interview.update({
      where: { id: interview.id },
      data: {
        status: 'STARTED',
        startedAt: interview.startedAt || now,
      },
    });

    await this.prisma.candidate.update({
      where: { id: interview.candidateId },
      data: { status: 'IN_PROGRESS' },
    });

    const roomName = `interview_${interview.id}`;
    const livekitUrl =
      this.configService.get<string>('LIVEKIT_URL') || 'wss://demo.livekit.cloud';
    const apiKey =
      this.configService.get<string>('LIVEKIT_API_KEY') || 'devkey';
    const apiSecret =
      this.configService.get<string>('LIVEKIT_API_SECRET') || 'secret';

    // Room metadata passed to the Python LiveKit agent
    const roomMetadata = JSON.stringify({
      interviewId: interview.id,
      candidateName: interview.candidate.name || 'Candidate',
      jobTitle: interview.candidate.job.title,
      questions: interview.candidate.job.questions,
      maxDurationSeconds: 600, // 10 minutes limit
    });

    const at = new AccessToken(apiKey, apiSecret, {
      identity: `candidate_${interview.candidate.id}`,
      name: interview.candidate.name || 'Candidate',
      metadata: roomMetadata,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const livekitToken = await at.toJwt();

    return {
      message: 'Interview session initialized',
      interviewId: interview.id,
      roomName,
      livekitUrl,
      livekitToken,
      maxDurationSeconds: 600,
    };
  }

  /**
   * Internal endpoint queried by the Python LiveKit agent to retrieve questions.
   */
  async getLivekitData(interviewId: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        candidate: {
          include: {
            job: {
              include: {
                questions: { orderBy: { order: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new NotFoundException(`Interview with ID "${interviewId}" not found`);
    }

    return {
      interviewId: interview.id,
      candidateName: interview.candidate.name,
      jobTitle: interview.candidate.job.title,
      questions: interview.candidate.job.questions,
      maxDurationSeconds: 600,
    };
  }

  /**
   * Called by the LiveKit Python worker upon interview termination.
   * Stores the complete conversation transcript and updates status.
   */
  async completeInterview(interviewId: string, dto: CompleteInterviewDto) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
    });

    if (!interview) {
      throw new NotFoundException(`Interview with ID "${interviewId}" not found`);
    }

    const now = new Date();

    // Mark Interview as COMPLETED
    await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        status: 'COMPLETED',
        completedAt: now,
      },
    });

    // Mark Candidate as COMPLETED
    await this.prisma.candidate.update({
      where: { id: interview.candidateId },
      data: { status: 'COMPLETED' },
    });

    // Save full transcript into InterviewReport analysis
    await this.prisma.interviewReport.upsert({
      where: { interviewId },
      create: {
        interviewId,
        analysis: {
          transcript: dto.transcript,
          durationSeconds: dto.durationSeconds,
          completedAt: now.toISOString(),
        },
      },
      update: {
        analysis: {
          transcript: dto.transcript,
          durationSeconds: dto.durationSeconds,
          completedAt: now.toISOString(),
        },
      },
    });

    this.logger.log(
      `Interview ${interviewId} marked COMPLETED with ${dto.transcript.length} conversation turns logged.`,
    );

    return {
      message: 'Interview completed and transcript saved successfully',
      interviewId,
    };
  }
}
