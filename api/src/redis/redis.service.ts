import { Injectable, OnModuleDestroy, Logger, BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, ChainableCommander } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy, BeforeApplicationShutdown {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    // Standard Redis connection configuration:
    // Redis uses an asynchronous, non-blocking single multiplexed socket connection.
    // keepAlive prevents idle timeouts; retryStrategy implements exponential backoff with jitter.
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      keepAlive: 10000,
      connectTimeout: 10000,
      retryStrategy: (times) => {
        if (times > 10) {
          this.logger.error('Redis retry attempts exhausted (>10). Retrying every 5s...');
          return 5000;
        }
        // Exponential backoff with random jitter: min 100ms, max 3000ms
        const delay = Math.min(times * 150 + Math.random() * 100, 3000);
        return delay;
      },
    });

    this.client.on('connect', () => {
      this.logger.log('Redis client connected');
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready to handle commands');
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  // ============================================================================
  // Abstract / Generic Key-Value Operations
  // ============================================================================

  /**
   * Retrieve a value by key, with automatic JSON deserialization if applicable.
   */
  async get<T = string>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (data === null) {
      return null;
    }
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  /**
   * Set a key-value pair with an optional TTL in seconds.
   * Objects/arrays are automatically serialized to JSON.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Delete one or more keys.
   */
  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  /**
   * Check if a key exists in Redis.
   */
  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  /**
   * Set expiration timeout in seconds on a key.
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  /**
   * Get remaining TTL of a key in seconds (-1 = no expire, -2 = does not exist).
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // ============================================================================
  // Abstract / Generic Set Operations
  // ============================================================================

  /**
   * Add one or more members to a set.
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, ...members);
  }

  /**
   * Remove one or more members from a set.
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, ...members);
  }

  /**
   * Get all members of a set.
   */
  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  /**
   * Check if a member belongs to a set.
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  // ============================================================================
  // Abstract Numeric / Counter Operations
  // ============================================================================

  /**
   * Increment integer value of a key by 1.
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Decrement integer value of a key by 1.
   */
  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // ============================================================================
  // Transactions & Raw Access
  // ============================================================================

  /**
   * Create a multi transaction commander for atomic execution.
   */
  multi(): ChainableCommander {
    return this.client.multi();
  }

  /**
   * Create a pipeline commander for batch command queuing without blocking.
   */
  pipeline(): ChainableCommander {
    return this.client.pipeline();
  }

  /**
   * Access underlying Redis client instance.
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Factory method to create a dedicated, isolated Redis connection.
   * Essential for Pub/Sub or blocking queue commands (BLPOP/BRPOP) which must
   * not tie up the primary multiplexed command connection.
   */
  createDedicatedClient(): Redis {
    return this.client.duplicate();
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  async beforeApplicationShutdown() {
    this.logger.log('Closing Redis connection...');
    await this.client.quit();
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
