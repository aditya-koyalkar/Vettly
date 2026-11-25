import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import {
  refreshSchema,
  signInSchema,
  signOutSchema,
  signUpSchema,
  type Refresh,
  type SignIn,
  type SignOut,
  type SignUp,
} from './auth.schemas.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup')
  signUp(@Body({ schema: signUpSchema }) body: SignUp) {
    return this.authService.signUp(body);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  signIn(@Body({ schema: signInSchema }) body: SignIn) {
    return this.authService.signIn(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body({ schema: refreshSchema }) body: Refresh) {
    return this.authService.refreshTokens(body);
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  signOut(@CurrentUser() user: AuthenticatedUser, @Body({ schema: signOutSchema }) body: SignOut) {
    return this.authService.signOut(user.id, user.jti, user.exp, body.refreshToken);
  }

  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  revokeAll(@CurrentUser('id') userId: string) {
    return this.authService.revokeAllSessions(userId);
  }

  @Get('me')
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }
}
