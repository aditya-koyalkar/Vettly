import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../../auth/decorators/public.decorator.js';
import {
  agentCompleteSchema,
  agentNoteSchema,
  agentSearchSchema,
  type AgentComplete,
  type AgentNote,
  type AgentSearch,
} from '../sessions.schemas.js';
import { InterviewRuntimeService } from './interview-runtime.service.js';
import { ServiceKeyGuard } from './service-key.guard.js';

const id = z.uuid();

/** Machine-to-machine API for the LiveKit agent worker. Not for browsers. */
@Public()
@SkipThrottle()
@UseGuards(ServiceKeyGuard)
@Controller('internal/sessions/:id')
export class InternalSessionsController {
  constructor(private readonly runtime: InterviewRuntimeService) {}

  @Get('context')
  context(@Param('id', { schema: id }) sessionId: string) {
    return this.runtime.context(sessionId);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Param('id', { schema: id }) sessionId: string, @Body({ schema: agentSearchSchema }) body: AgentSearch) {
    return this.runtime.search(sessionId, body);
  }

  @Post('notes')
  note(@Param('id', { schema: id }) sessionId: string, @Body({ schema: agentNoteSchema }) body: AgentNote) {
    return this.runtime.addNote(sessionId, body);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id', { schema: id }) sessionId: string, @Body({ schema: agentCompleteSchema }) body: AgentComplete) {
    return this.runtime.complete(sessionId, body);
  }
}
