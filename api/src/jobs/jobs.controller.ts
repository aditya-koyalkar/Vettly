import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateJobDto) {
    return this.jobsService.create(userId, dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobsService.update(userId, id, dto);
  }

  @Get()
  async findAll(@CurrentUser('id') userId: string) {
    return this.jobsService.findAll(userId);
  }

  @Get(':id')
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.jobsService.findOne(userId, id);
  }
}
