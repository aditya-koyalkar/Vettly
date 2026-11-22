import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new job posting for the authenticated recruiter.
   * Enforces free-tier limit of max 1 job posting.
   */
  async create(userId: string, dto: CreateJobDto) {
    // 1. Enforce free tier constraint: max 1 active project/job
    const currentJobsCount = await this.prisma.job.count({
      where: { userId },
    });

    if (currentJobsCount >= 1) {
      throw new BadRequestException(
        'Free tier limit reached: You can only create 1 job posting. Upgrade to create more.',
      );
    }

    // 2. Generate or sanitize jobId
    const jobId =
      dto.jobId?.trim() || `JOB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // 3. Ensure unique jobId
    const existing = await this.prisma.job.findUnique({
      where: { jobId },
    });

    if (existing) {
      throw new ConflictException(`A job with ID "${jobId}" already exists`);
    }

    // 4. Create Job
    const job = await this.prisma.job.create({
      data: {
        jobId,
        title: dto.title,
        description: dto.description,
        requirements: dto.requirements ?? undefined,
        experience: dto.experience,
        location: dto.location,
        status: dto.status ?? 'DRAFT',
        userId,
      },
      include: {
        _count: {
          select: { questions: true, candidates: true },
        },
      },
    });

    return {
      message: 'Job posting created successfully',
      job,
    };
  }

  /**
   * Update job information.
   * Ensures ownership check before modification.
   */
  async update(userId: string, id: string, dto: UpdateJobDto) {
    // 1. Check job existence
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job posting with ID "${id}" not found`);
    }

    // 2. Ownership verification
    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have permission to modify this job posting');
    }

    // 3. Perform update
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.requirements !== undefined && { requirements: dto.requirements }),
        ...(dto.experience !== undefined && { experience: dto.experience }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: {
        _count: {
          select: { questions: true, candidates: true },
        },
      },
    });

    return {
      message: 'Job posting updated successfully',
      job: updated,
    };
  }

  /**
   * List all job postings for the authenticated recruiter.
   */
  async findAll(userId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { questions: true, candidates: true },
        },
      },
    });

    return { jobs };
  }

  /**
   * Retrieve a single job posting by ID.
   */
  async findOne(userId: string, id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { order: 'asc' },
        },
        _count: {
          select: { candidates: true, questions: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job posting with ID "${id}" not found`);
    }

    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have access to this job posting');
    }

    return { job };
  }
}
