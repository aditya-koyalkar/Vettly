import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCandidateDto } from './dto/create-candidate.dto.js';

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Invites a candidate to take the interview for a job posting.
   * Generates a unique, secure, expired token and creates Candidate + Interview records.
   */
  async addCandidate(userId: string, jobId: string, dto: CreateCandidateDto) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { _count: { select: { questions: true } } },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID "${jobId}" not found`);
    }

    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have permission to invite candidates for this job');
    }

    // Check if candidate is already invited for this job
    const existing = await this.prisma.candidate.findUnique({
      where: {
        jobId_email: {
          jobId,
          email: dto.email.toLowerCase(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Candidate with email "${dto.email}" is already registered for this job`);
    }

    // Generate secure unique interview access token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const expiresInDays = dto.expiresInDays ?? 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    // Create Candidate and Interview atomically
    const candidate = await this.prisma.candidate.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        jobId,
        interview: {
          create: {
            tokenHash,
            expiresAt,
            status: 'PENDING',
          },
        },
      },
      include: {
        interview: true,
      },
    });

    const interviewUrl = `${frontendUrl}/interview/${token}`;

    return {
      message: 'Candidate invited successfully',
      candidate: {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        status: candidate.status,
        expiresAt,
        interviewUrl,
        token, // Returned once so recruiter/UI can copy or email immediately
      },
    };
  }

  /**
   * Lists all candidates for a job posting with interview progress and scores.
   */
  async listCandidates(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID "${jobId}" not found`);
    }

    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have access to this job');
    }

    const candidates = await this.prisma.candidate.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
      include: {
        interview: {
          include: {
            report: {
              select: {
                id: true,
                overallScore: true,
                recommendation: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return { candidates };
  }
}
