import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  BeforeApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService manages the PostgreSQL database connection and connection pool.
 *
 * PostgreSQL Connection Pooling Architecture:
 * - PostgreSQL uses a process-per-connection model. Every concurrent SQL transaction
 *   requires a dedicated TCP connection.
 * - Prisma manages its connection pool internally via its query engine.
 * - Pool size and timeouts are tuned via connection string query parameters:
 *   e.g. `postgresql://user:pass@host:5432/db?schema=public&connection_limit=10&pool_timeout=20`
 *   - `connection_limit`: Max simultaneous connections in the pool (default: num_cpus * 2 + 1).
 *   - `pool_timeout`: Seconds to wait for a free connection before throwing P2024 error.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'stdout', level: 'info' },
              { emit: 'stdout', level: 'warn' },
              { emit: 'stdout', level: 'error' },
            ]
          : [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('PostgreSQL database connected with Prisma connection pool');
    } catch (error: any) {
      this.logger.error(`Failed to connect to PostgreSQL: ${error?.message}`);
      throw error;
    }
  }

  async beforeApplicationShutdown() {
    this.logger.log('Disconnecting Prisma PostgreSQL pool...');
    await this.$disconnect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
