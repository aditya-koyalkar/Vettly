import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { PrismaService } from '../prisma/prisma.service.js';
import { GenerateQuestionsDto } from './dto/generate-questions.dto.js';
import { RegenerateQuestionDto } from './dto/regenerate-question.dto.js';

const RubricSchema = z.object({
  keyConcepts: z.array(z.string()).describe('Key concepts candidate must demonstrate understanding of'),
  goodAnswerSignals: z.array(z.string()).describe('Positive signals indicating strong competence'),
  redFlags: z.array(z.string()).describe('Superficial answers, buzzword stuffing, or warning signs'),
  followUpGuidance: z.string().describe('Guidance for Voice AI on probing deeper if candidate answer is brief'),
});

const QuestionItemSchema = z.object({
  question: z.string().describe('Spoken dialogue interview question text'),
  type: z.enum(['TECHNICAL', 'BEHAVIORAL', 'SYSTEM_DESIGN', 'PROBLEM_SOLVING']).describe('Question type'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).describe('Difficulty level'),
  order: z.number().int().min(1).max(5).describe('Order 1 to 5'),
  evaluation: RubricSchema.describe('Evaluation rubric for Voice AI'),
});

const QuestionsBatchSchema = z.object({
  summary: z.string().describe('Brief overview of the interview question strategy'),
  questions: z.array(QuestionItemSchema).min(1).max(5).describe('Exactly 5 questions in logical order'),
});

const SingleQuestionAlternativeSchema = z.object({
  question: z.string().describe('The new alternative interview question'),
  type: z.enum(['TECHNICAL', 'BEHAVIORAL', 'SYSTEM_DESIGN', 'PROBLEM_SOLVING']).describe('Question type'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).describe('Difficulty level'),
  evaluation: RubricSchema.describe('Evaluation rubric for Voice AI'),
});

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly llm: ChatOpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY') || '';
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY is not configured. AI question generation calls will fail until set.');
    }

    this.llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      apiKey,
      temperature: 0.3,
    });
  }

  /**
   * One-Click AI Question Generation for a job posting.
   * Synthesizes 5 tailored questions with full rubrics and saves them to the DB.
   */
  async generateQuestionsForJob(userId: string, jobId: string, dto?: GenerateQuestionsDto) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID "${jobId}" not found`);
    }

    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have permission to modify this job');
    }

    const structuredLlm = this.llm.withStructuredOutput(QuestionsBatchSchema);

    const systemPrompt =
      'You are an expert talent assessment designer for Vettly. ' +
      'Generate exactly 5 high-impact, open-ended first-round interview questions for a 10-minute voice screen.\n' +
      'Rules:\n' +
      '1. Create exactly 5 questions in progressive order (fundamentals -> deep technical -> problem-solving -> architecture/behavioral).\n' +
      '2. Must be conversational and suitable for spoken dialogue (not writing code).\n' +
      '3. Assign sequential order numbers 1 to 5.\n' +
      '4. Provide a rich evaluation rubric for each question including key concepts, good answer signals, red flags, and Voice AI follow-up guidance.';

    const userPrompt =
      `Job Title: ${job.title}\n` +
      `Experience Level: ${job.experience || 'Not specified'}\n` +
      `Location: ${job.location || 'Remote'}\n` +
      `Description:\n${job.description}\n` +
      `Requirements:\n${JSON.stringify(job.requirements || {})}\n` +
      (dto?.prompt ? `Recruiter Custom Focus: ${dto.prompt}\n` : '');

    try {
      const result = await structuredLlm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const formattedQuestions = result.questions.slice(0, 5).map((q, idx) => ({
        question: q.question,
        type: q.type,
        difficulty: q.difficulty,
        evaluation: q.evaluation as any,
        order: idx + 1,
        jobId: job.id,
      }));

      // Atomically replace questions for this job in Postgres
      await this.prisma.$transaction([
        this.prisma.question.deleteMany({ where: { jobId: job.id } }),
        this.prisma.question.createMany({
          data: formattedQuestions,
        }),
      ]);

      const savedQuestions = await this.prisma.question.findMany({
        where: { jobId: job.id },
        orderBy: { order: 'asc' },
      });

      return {
        message: '5 interview questions generated successfully',
        summary: result.summary,
        questions: savedQuestions,
      };
    } catch (err: any) {
      this.logger.error(`Error generating questions: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException(`Failed to generate questions: ${err?.message}`);
    }
  }

  /**
   * One-Click Regenerate a single question with optional instructions.
   */
  async regenerateSingleQuestion(
    userId: string,
    jobId: string,
    questionId: string,
    dto?: RegenerateQuestionDto,
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        questions: { orderBy: { order: 'asc' } },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID "${jobId}" not found`);
    }

    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have access to this job');
    }

    const existingQuestion = job.questions.find((q) => q.id === questionId);
    if (!existingQuestion) {
      throw new NotFoundException(`Question with ID "${questionId}" not found`);
    }

    const structuredLlm = this.llm.withStructuredOutput(SingleQuestionAlternativeSchema);

    const otherQuestions = job.questions
      .filter((q) => q.id !== questionId)
      .map((q) => `Q${q.order}: ${q.question}`)
      .join('\n');

    const systemPrompt =
      'You are an expert talent assessment designer for Vettly. ' +
      'Generate a fresh, improved alternative interview question to replace an existing question for a 10-minute voice screen.\n' +
      'Rules:\n' +
      '1. The new question must fit cohesively with the remaining interview questions without duplicating them.\n' +
      '2. Must be conversational and open-ended for voice.\n' +
      '3. Provide a rich evaluation rubric (key concepts, good signals, red flags, follow-up guidance).';

    const userPrompt =
      `Job Title: ${job.title}\n` +
      `Description:\n${job.description}\n` +
      `Current Question to Replace: "${existingQuestion.question}" (Type: ${existingQuestion.type}, Difficulty: ${existingQuestion.difficulty})\n` +
      `Other Questions in the Interview:\n${otherQuestions}\n` +
      (dto?.instructions ? `Recruiter's Specific Change Request: ${dto.instructions}\n` : '');

    try {
      const result = await structuredLlm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const updated = await this.prisma.question.update({
        where: { id: questionId },
        data: {
          question: result.question,
          type: result.type,
          difficulty: result.difficulty,
          evaluation: result.evaluation as any,
        },
      });

      return {
        message: 'Question regenerated successfully',
        question: updated,
      };
    } catch (err: any) {
      this.logger.error(`Error regenerating question: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException(`Failed to regenerate question: ${err?.message}`);
    }
  }
}
