import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { createSessionSchema, type CreateSession } from './sessions.schemas.js';
import { SessionsService } from './sessions.service.js';

const id = z.uuid();

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body({ schema: createSessionSchema }) body: CreateSession) {
    return this.sessions.create(userId, body);
  }

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.sessions.list(userId);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id', { schema: id }) sessionId: string) {
    return this.sessions.get(userId, sessionId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('id') userId: string, @Param('id', { schema: id }) sessionId: string) {
    return this.sessions.remove(userId, sessionId);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@CurrentUser('id') userId: string, @Param('id', { schema: id }) sessionId: string) {
    return this.sessions.retry(userId, sessionId);
  }

  /** Returns LiveKit credentials; joining dispatches the interviewer agent. */
  @Post(':id/join')
  join(@CurrentUser() user: AuthenticatedUser, @Param('id', { schema: id }) sessionId: string) {
    return this.sessions.join(user.id, user.name, sessionId);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(@CurrentUser('id') userId: string, @Param('id', { schema: id }) sessionId: string) {
    return this.sessions.end(userId, sessionId);
  }
}
