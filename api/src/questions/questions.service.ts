import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateQuestionDto } from './dto/create-question.dto.js';
import { UpdateQuestionDto } from './dto/update-question.dto.js';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto.js';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyJobAccess(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID "${jobId}" not found`);
    }

    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have access to this job');
    }

    return job;
  }

  /**
   * List all questions for a job.
   */
  async findAll(userId: string, jobId: string) {
    await this.verifyJobAccess(userId, jobId);

    const questions = await this.prisma.question.findMany({
      where: { jobId },
      orderBy: { order: 'asc' },
    });

    return { questions };
  }

  /**
   * Manually create an interview question (max 5 questions cap).
   */
  async create(userId: string, jobId: string, dto: CreateQuestionDto) {
    await this.verifyJobAccess(userId, jobId);

    const existingCount = await this.prisma.question.count({
      where: { jobId },
    });

    if (existingCount >= 5) {
      throw new BadRequestException(
        'Maximum limit of 5 questions reached for this interview. Delete or edit an existing question.',
      );
    }

    const order = dto.order ?? existingCount + 1;

    const question = await this.prisma.question.create({
      data: {
        question: dto.question,
        type: dto.type ?? 'TECHNICAL',
        difficulty: dto.difficulty ?? 'MEDIUM',
        evaluation: dto.evaluation ?? undefined,
        order,
        jobId,
      },
    });

    return {
      message: 'Question added successfully',
      question,
    };
  }

  /**
   * Update a question's text, category, difficulty, or evaluation rubric.
   */
  async update(userId: string, jobId: string, questionId: string, dto: UpdateQuestionDto) {
    await this.verifyJobAccess(userId, jobId);

    const question = await this.prisma.question.findFirst({
      where: { id: questionId, jobId },
    });

    if (!question) {
      throw new NotFoundException(`Question with ID "${questionId}" not found for this job`);
    }

    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        ...(dto.question !== undefined && { question: dto.question }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }),
        ...(dto.evaluation !== undefined && { evaluation: dto.evaluation }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });

    return {
      message: 'Question updated successfully',
      question: updated,
    };
  }

  /**
   * Delete a question and re-order remaining questions.
   */
  async delete(userId: string, jobId: string, questionId: string) {
    await this.verifyJobAccess(userId, jobId);

    const question = await this.prisma.question.findFirst({
      where: { id: questionId, jobId },
    });

    if (!question) {
      throw new NotFoundException(`Question with ID "${questionId}" not found`);
    }

    await this.prisma.question.delete({
      where: { id: questionId },
    });

    // Re-sequence remaining questions to orders 1..N
    const remaining = await this.prisma.question.findMany({
      where: { jobId },
      orderBy: { order: 'asc' },
    });

    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order !== i + 1) {
        await this.prisma.question.update({
          where: { id: remaining[i].id },
          data: { order: i + 1 },
        });
      }
    }

    return {
      message: 'Question deleted successfully',
    };
  }

  /**
   * Reorder questions in bulk.
   */
  async reorder(userId: string, jobId: string, dto: ReorderQuestionsDto) {
    await this.verifyJobAccess(userId, jobId);

    const updates = dto.orders.map((item) =>
      this.prisma.question.update({
        where: { id: item.id },
        data: { order: item.order },
      }),
    );

    await this.prisma.$transaction(updates);

    const questions = await this.prisma.question.findMany({
      where: { jobId },
      orderBy: { order: 'asc' },
    });

    return {
      message: 'Questions reordered successfully',
      questions,
    };
  }
}
