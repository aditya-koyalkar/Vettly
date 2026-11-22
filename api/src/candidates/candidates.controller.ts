import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CandidatesService } from './candidates.service.js';
import { CreateCandidateDto } from './dto/create-candidate.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@Controller('jobs/:id/candidates')
@UseGuards(JwtAuthGuard)
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addCandidate(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Body() dto: CreateCandidateDto,
  ) {
    return this.candidatesService.addCandidate(userId, jobId, dto);
  }

  @Get()
  async listCandidates(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
  ) {
    return this.candidatesService.listCandidates(userId, jobId);
  }
}
