import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InterviewsService } from './interviews.service.js';
import { CompleteInterviewDto } from './dto/complete-interview.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  /**
   * Candidate verifies their token upon opening the invite URL.
   */
  @Public()
  @Get('verify/:token')
  async verifyToken(@Param('token') token: string) {
    return this.interviewsService.verifyInterviewToken(token);
  }

  /**
   * Candidate confirms and launches the LiveKit WebRTC session.
   */
  @Public()
  @Post('start/:token')
  @HttpCode(HttpStatus.OK)
  async startSession(@Param('token') token: string) {
    return this.interviewsService.startInterviewSession(token);
  }

  /**
   * Python LiveKit agent queries interview questions if not present in room metadata.
   */
  @Public()
  @Get(':id/livekit-data')
  async getLivekitData(@Param('id') interviewId: string) {
    return this.interviewsService.getLivekitData(interviewId);
  }

  /**
   * Python LiveKit agent posts full transcript and duration upon interview conclusion.
   */
  @Public()
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async completeInterview(
    @Param('id') interviewId: string,
    @Body() dto: CompleteInterviewDto,
  ) {
    return this.interviewsService.completeInterview(interviewId, dto);
  }
}
