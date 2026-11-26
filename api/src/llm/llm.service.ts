import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessageLike } from '@langchain/core/messages';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { z } from 'zod';
import type { Env } from '../config/env.js';

export const EMBEDDING_DIMENSIONS = 768;

interface ModelSlot {
  /** Human-readable id, persisted on reports for traceability. */
  id: string;
  model: BaseChatModel;
}

interface KeyEntry {
  label: string;
  apiKey: string;
  embeddings: OpenAIEmbeddings;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

export interface StructuredOptions {
  /** Used for logs and as the tool/function name for structured output. */
  name: string;
  temperature?: number;
}

/**
 * Model gateway for every non-realtime LLM and embedding call in the API,
 * routed through OpenRouter with key rotation (primary/secondary) and ordered
 * model fallbacks for high availability.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly keys: KeyEntry[];
  private readonly baseURL: string;
  private rrIndex = 0;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.baseURL = this.config.get('OPENROUTER_BASE_URL', { infer: true });
    const embeddingModel = this.config.get('OPENROUTER_EMBEDDING_MODEL', { infer: true });

    const candidates: Array<{ label: string; apiKey: string | undefined }> = [
      { label: 'primary', apiKey: this.config.get('OPENROUTER_API_KEY', { infer: true }) },
      { label: 'secondary', apiKey: this.config.get('OPENROUTER_API_KEY_SECONDARY', { infer: true }) },
    ];

    const seen = new Set<string>();
    this.keys = candidates
      .filter((c): c is { label: string; apiKey: string } => {
        const trimmed = c.apiKey?.trim();
        if (!trimmed || seen.has(trimmed)) return false;
        seen.add(trimmed);
        return true;
      })
      .map((c) => ({
        label: c.label,
        apiKey: c.apiKey,
        embeddings: new OpenAIEmbeddings({
          apiKey: c.apiKey,
          model: embeddingModel,
          dimensions: EMBEDDING_DIMENSIONS,
          configuration: { baseURL: this.baseURL },
        }),
      }));
  }

  /** Round-robins the starting key so parallel bursts split RPM across keys. */
  private orderedKeys(): KeyEntry[] {
    if (this.keys.length <= 1) return this.keys;
    const start = this.rrIndex % this.keys.length;
    this.rrIndex = (this.rrIndex + 1) % this.keys.length;
    return [...this.keys.slice(start), ...this.keys.slice(0, start)];
  }

  private chain(temperature: number): ModelSlot[] {
    const models = [
      this.config.get('OPENROUTER_LLM_MODEL', { infer: true }),
      this.config.get('OPENROUTER_LLM_FALLBACK_1', { infer: true }),
      this.config.get('OPENROUTER_LLM_FALLBACK_2', { infer: true }),
    ].filter((model) => model.trim().length > 0);

    const keys = this.orderedKeys();
    const slots: ModelSlot[] = [];
    for (const model of models) {
      for (const key of keys) {
        slots.push({
          id: `openrouter/${model}`,
          model: new ChatOpenAI({
            apiKey: key.apiKey,
            model,
            temperature,
            maxTokens: 8192,
            maxRetries: 0,
            // Nemotron models default to lengthy internal reasoning that
            // hits token/time limits on structured JSON; disable it when supported.
            modelKwargs: model.includes('nemotron') ? { reasoning: { enabled: false } } : undefined,
            configuration: { baseURL: this.baseURL },
          }),
        });
      }
    }
    return slots;
  }

  /**
   * Runs a prompt that must return data matching `schema`, walking the
   * OpenRouter key + model chain until one succeeds.
   */
  async structured<S extends z.ZodType<Record<string, unknown>>>(
    schema: S,
    messages: BaseMessageLike[],
    { name, temperature = 0.2 }: StructuredOptions,
    timeoutMs = 60_000,
  ): Promise<StructuredResult<z.infer<S>>> {
    const failures: string[] = [];
    for (const slot of this.chain(temperature)) {
      const started = Date.now();
      try {
        const runnable = slot.model.withStructuredOutput(schema, { name });
        const raw = await runnable.invoke(messages, { signal: AbortSignal.timeout(timeoutMs) });
        // Re-validate: some providers return loosely-typed JSON even in tool mode.
        const data = schema.parse(raw);
        this.logger.log(`${name} ← ${slot.id} in ${Date.now() - started}ms`);
        return { data, model: slot.id };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${slot.id}: ${reason.slice(0, 200)}`);
        this.logger.warn(`${name} failed on ${slot.id} after ${Date.now() - started}ms: ${reason.slice(0, 200)}`);
      }
    }
    throw new ServiceUnavailableException(`All LLM providers failed for ${name}: ${failures.join(' | ')}`);
  }

  /** Embeds document chunks. Returns null when all embedding keys are unavailable. */
  async embedDocuments(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];
    for (const key of this.orderedKeys()) {
      try {
        return await key.embeddings.embedDocuments(texts);
      } catch (error) {
        this.logger.warn(`Document embedding failed (${key.label}): ${String(error)}`);
      }
    }
    this.logger.warn('All embedding keys failed, falling back to lexical-only retrieval');
    return null;
  }

  /** Embeds a search query. Returns null when all embedding keys are unavailable. */
  async embedQuery(text: string): Promise<number[] | null> {
    for (const key of this.orderedKeys()) {
      try {
        return await key.embeddings.embedQuery(text);
      } catch (error) {
        this.logger.warn(`Query embedding failed (${key.label}): ${String(error)}`);
      }
    }
    this.logger.warn('All embedding keys failed, using lexical-only retrieval');
    return null;
  }
}
