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
  keyConcepts: z
    .array(z.string())
    .describe('Crucial technical concepts candidate must demonstrate understanding of'),
  goodAnswerSignals: z
    .array(z.string())
    .describe('Clear positive signals indicating high competence and structured thinking'),
  redFlags: z
    .array(z.string())
    .describe('Superficial answers, buzzword stuffing, or warning signs'),
  followUpGuidance: z
    .string()
    .describe('Guidance for Voice AI on probing deeper if candidate answer is brief'),
});

const QuestionItemSchema = z.object({
  question: z.string().describe('Spoken dialogue interview question text'),
  type: z
    .enum(['TECHNICAL', 'BEHAVIORAL', 'SYSTEM_DESIGN', 'PROBLEM_SOLVING'])
    .describe('Category of question'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).describe('Target difficulty level'),
  order: z.number().int().min(1).max(5).describe('Order 1 to 5'),
  evaluation: RubricSchema.describe('Evaluation rubric for Voice AI scoring and follow-ups'),
});

const QuestionsBatchSchema = z.object({
  summary: z.string().describe('Brief strategic overview of the 5-question interview progression'),
  questions: z.array(QuestionItemSchema).min(1).max(5).describe('Exactly 5 questions in progressive order'),
});

const SingleQuestionAlternativeSchema = z.object({
  question: z.string().describe('The fresh alternative interview question'),
  type: z
    .enum(['TECHNICAL', 'BEHAVIORAL', 'SYSTEM_DESIGN', 'PROBLEM_SOLVING'])
    .describe('Category of question'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).describe('Target difficulty level'),
  evaluation: RubricSchema.describe('Evaluation rubric for Voice AI scoring and follow-ups'),
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

    const systemPrompt = `
<role>
You are an expert talent assessment designer for Vettly, an automated first-round voice interview platform.
Your objective is to design exactly 5 high-impact, open-ended interview questions for a 10-minute AI voice screen.
</role>

<interview_format>
- Channel: Real-time WebRTC Voice AI Agent.
- Duration: 10 minutes total (~2 minutes per question).
- Modality: Spoken dialogue only (no live code writing, no whiteboard drawings).
</interview_format>

<progression_framework>
Order the 5 questions in a logical evaluation sequence:
1. Question 1: Role Fundamentals & Architecture Overview (icebreaker with technical substance).
2. Question 2: Deep Core Technical Proficiency (language, framework, or database internals).
3. Question 3: Complex Problem Solving & Troubleshooting (real-world debugging or edge case handling).
4. Question 4: System Design, Scalability & Trade-offs.
5. Question 5: Ownership, Collaboration & Engineering Judgment (behavioral with engineering context).
</progression_framework>

<rubric_standards>
For each question, provide an exhaustive evaluation rubric:
- Key Concepts: Specific architectural concepts, patterns, or tools the candidate should mention.
- Good Answer Signals: Indicators of first-hand experience (e.g. discussing failure modes, trade-offs).
- Red Flags: Warning signs (e.g. memorized definitions without depth, buzzword dropping).
- Follow-up Guidance: Specific instructions for the Voice AI on when and how to probe deeper.
</rubric_standards>

<few_shot_exemplar>
Example of a gold-standard Question and Rubric output:
{{
  "order": 2,
  "type": "TECHNICAL",
  "difficulty": "HARD",
  "question": "When configuring a distributed PostgreSQL cluster with read replicas, how do you handle replication lag when a user performs a write followed immediately by a critical read?",
  "evaluation": {{
    "keyConcepts": ["Replication lag", "Write-ahead log (WAL)", "Read-your-own-writes consistency", "Primary sticky routing", "Synchronous vs asynchronous replication"],
    "goodAnswerSignals": ["Distinguishes between eventual consistency and monotonic read consistency", "Suggests pinning the user's connection to the primary for a time window after writes", "Mentions LSN (Log Sequence Number) checking on replicas"],
    "redFlags": ["Suggests adding Redis without explaining cache invalidation", "Claims asynchronous replication has zero lag", "Unaware that read replicas can serve stale data"],
    "followUpGuidance": "If the candidate only suggests caching, ask: 'If caching is not an option, how would you ensure the database connection router guarantees read-your-own-writes consistency?'"
  }}
}}
</few_shot_exemplar>

<output_constraints>
- Produce exactly 5 questions assigned order numbers 1 through 5.
- Phrase questions conversationally as if spoken by a senior engineering peer.
</output_constraints>
`.trim();

    const userPrompt = `
<job_specification>
- Title: ${job.title}
- Experience Level: ${job.experience || 'Not specified'}
- Location: ${job.location || 'Remote'}
- Description:
${job.description}

- Requirements:
${JSON.stringify(job.requirements || {})}
${dto?.prompt ? `\n- Recruiter Custom Focus / Instructions: "${dto.prompt}"` : ''}
</job_specification>
`.trim();

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
      .map((q) => `Q${q.order} (${q.type}): ${q.question}`)
      .join('\n');

    const systemPrompt = `
<role>
You are an expert talent assessment designer for Vettly.
Your task is to generate a single fresh, improved alternative interview question to replace an existing question.
</role>

<rules>
1. Cohesion: The replacement question must complement the other active interview questions without duplicating their topics.
2. Spoken Dialogue: Formulate the question conversationally for a live 10-minute voice interview.
3. Rubric Depth: Include key concepts, positive signals, red flags, and Voice AI follow-up guidance.
</rules>
`.trim();

    const userPrompt = `
<context>
- Job Title: ${job.title}
- Job Description: ${job.description}
- Active Questions (Do NOT duplicate these topics):
${otherQuestions}

- Question Being Replaced:
"${existingQuestion.question}" (Type: ${existingQuestion.type}, Difficulty: ${existingQuestion.difficulty})
${dto?.instructions ? `\n- Recruiter Requested Changes: "${dto.instructions}"` : ''}
</context>
`.trim();

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
