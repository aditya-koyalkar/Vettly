import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { SignUpDto } from './dto/signup.dto.js';
import { SignInDto } from './dto/signin.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

@Injectable()
export class AuthService {
  private readonly refreshTokenTtlSeconds = 7 * 24 * 60 * 60; // 7 days

  // Redis Key Namespace Constants
  private readonly REFRESH_KEY_PREFIX = 'auth:refresh:';
  private readonly USER_SESSIONS_PREFIX = 'auth:user_sessions:';
  private readonly BLACKLIST_KEY_PREFIX = 'auth:blacklist:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private getRefreshKey(token: string): string {
    return `${this.REFRESH_KEY_PREFIX}${token}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `${this.USER_SESSIONS_PREFIX}${userId}`;
  }

  private getBlacklistKey(jti: string): string {
    return `${this.BLACKLIST_KEY_PREFIX}${jti}`;
  }

  async signUp(dto: SignUpDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        name: dto.name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    const tokens = await this.generateAndStoreTokens(user.id, user.email);

    return {
      message: 'Account created successfully',
      user,
      tokens,
    };
  }

  async signIn(dto: SignInDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateAndStoreTokens(user.id, user.email);

    return {
      message: 'Signed in successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      tokens,
    };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    const refreshKey = this.getRefreshKey(dto.refreshToken);

    // 1. Fetch user ID via abstract Redis get()
    const userId = await this.redis.get<string>(refreshKey);
    if (!userId) {
      throw new UnauthorizedException('Refresh token is invalid or has expired');
    }

    // 2. Look up user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('User account no longer exists');
    }

    // 3. Token Rotation: Atomically delete old token and remove from user session set
    const userSessionsKey = this.getUserSessionsKey(userId);
    await this.redis
      .multi()
      .del(refreshKey)
      .srem(userSessionsKey, dto.refreshToken)
      .exec();

    // 4. Issue and store new token pair
    const tokens = await this.generateAndStoreTokens(user.id, user.email);

    return {
      message: 'Tokens refreshed successfully',
      tokens,
    };
  }

  async signOut(userId: string, jti: string, exp: number, refreshToken?: string) {
    // 1. Blacklist access token JTI for its remaining duration
    const now = Math.floor(Date.now() / 1000);
    const remainingTtl = exp ? exp - now : 15 * 60;
    if (remainingTtl > 0 && jti) {
      await this.redis.set(this.getBlacklistKey(jti), 'revoked', remainingTtl);
    }

    // 2. Revoke refresh token if provided
    if (refreshToken) {
      const refreshKey = this.getRefreshKey(refreshToken);
      const userSessionsKey = this.getUserSessionsKey(userId);
      await this.redis
        .multi()
        .del(refreshKey)
        .srem(userSessionsKey, refreshToken)
        .exec();
    }

    return { message: 'Signed out successfully' };
  }

  async revokeAllSessions(userId: string) {
    const userSessionsKey = this.getUserSessionsKey(userId);
    const tokens = await this.redis.smembers(userSessionsKey);

    if (tokens.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const token of tokens) {
        pipeline.del(this.getRefreshKey(token));
      }
      pipeline.del(userSessionsKey);
      await pipeline.exec();
    }

    return { message: 'All active sessions have been revoked' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { user };
  }

  private async generateAndStoreTokens(userId: string, email: string) {
    const jti = crypto.randomUUID();

    const accessToken = await this.jwtService.signAsync(
      {
        sub: userId,
        email,
        jti,
      },
      {
        expiresIn: '15m',
      },
    );

    const refreshToken = crypto.randomBytes(40).toString('hex');

    // Atomically store refresh token with TTL and track inside user's active session set
    const refreshKey = this.getRefreshKey(refreshToken);
    const userSessionsKey = this.getUserSessionsKey(userId);

    await this.redis
      .multi()
      .set(refreshKey, userId, 'EX', this.refreshTokenTtlSeconds)
      .sadd(userSessionsKey, refreshToken)
      .expire(userSessionsKey, this.refreshTokenTtlSeconds * 2)
      .exec();

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 15 * 60,
    };
  }
}
