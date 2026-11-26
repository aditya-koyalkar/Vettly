import { z } from 'zod';

/**
 * Single source of truth for environment configuration. Validated once at
 * boot so a missing key fails fast instead of surfacing mid-interview.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16),

  /** Shared secret the LiveKit agent worker sends as `x-service-key`. */
  API_SERVICE_KEY: z.string().min(16),

  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_NAME: z.string().default('vettly-interviewer'),

  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY_SECONDARY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  OPENROUTER_LLM_MODEL: z.string().default('nvidia/nemotron-3.5-lightning:free'),
  OPENROUTER_LLM_FALLBACK_1: z.string().default('nvidia/nemotron-3-ultra-550b-a55b:free'),
  OPENROUTER_LLM_FALLBACK_2: z.string().default('google/gemma-4-31b-it:free'),
  OPENROUTER_EMBEDDING_MODEL: z.string().default('nvidia/nemotron-3.5-embed-8b:free'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
