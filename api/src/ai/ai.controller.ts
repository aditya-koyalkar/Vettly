import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AiService } from './ai.service.js';
import { GenerateQuestionsDto } from './dto/generate-questions.dto.js';
import { RegenerateQuestionDto } from './dto/regenerate-question.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@Controller('jobs/:id/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * One-Click generation of 5 tailored interview questions for a job.
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateQuestions(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Body() dto: GenerateQuestionsDto,
  ) {
    return this.aiService.generateQuestionsForJob(userId, jobId, dto);
  }

  /**
   * One-Click regeneration of a single question.
   */
  @Post('questions/:questionId/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateSingleQuestion(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Param('questionId') questionId: string,
    @Body() dto: RegenerateQuestionDto,
  ) {
    return this.aiService.regenerateSingleQuestion(userId, jobId, questionId, dto);
  }
}
