import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.js';

/** Authenticates the LiveKit agent worker via the shared `x-service-key` header. */
@Injectable()
export class ServiceKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.expected = Buffer.from(config.get('API_SERVICE_KEY', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const provided = context.switchToHttp().getRequest<Request>().header('x-service-key');
    const candidate = Buffer.from(provided ?? '');
    if (candidate.length !== this.expected.length || !timingSafeEqual(candidate, this.expected)) {
      throw new UnauthorizedException('Invalid service key');
    }
    return true;
  }
}
