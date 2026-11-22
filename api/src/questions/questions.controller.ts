import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QuestionsService } from './questions.service.js';
import { CreateQuestionDto } from './dto/create-question.dto.js';
import { UpdateQuestionDto } from './dto/update-question.dto.js';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@Controller('jobs/:id/questions')
@UseGuards(JwtAuthGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  async findAll(@CurrentUser('id') userId: string, @Param('id') jobId: string) {
    return this.questionsService.findAll(userId, jobId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.questionsService.create(userId, jobId, dto);
  }

  @Patch(':questionId')
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questionsService.update(userId, jobId, questionId, dto);
  }

  @Delete(':questionId')
  async delete(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Param('questionId') questionId: string,
  ) {
    return this.questionsService.delete(userId, jobId, questionId);
  }

  @Put('reorder')
  async reorder(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Body() dto: ReorderQuestionsDto,
  ) {
    return this.questionsService.reorder(userId, jobId, dto);
  }
}
