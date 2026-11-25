import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TaskType } from '@google/generative-ai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessageLike } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import type { z } from 'zod';
import type { Env } from '../config/env.js';

export const EMBEDDING_DIMENSIONS = 768;

interface ModelSlot {
  /** Human-readable id, persisted on reports for traceability. */
  id: string;
  model: BaseChatModel;
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
 * Model gateway for every non-realtime LLM call in the API.
 *
 * Provider chain: Gemini (free tier) → Groq primary → Groq secondary. Each
 * slot gets its own timeout, and the first slot that returns schema-valid
 * output wins. Free-tier quotas are the common failure mode, so falling
 * through quickly matters more than retrying the same provider.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly documentEmbeddings: GoogleGenerativeAIEmbeddings;
  private readonly queryEmbeddings: GoogleGenerativeAIEmbeddings;

  constructor(private readonly config: ConfigService<Env, true>) {
    // Gemini embeds documents and queries asymmetrically, so each task type
    // gets its own client rather than mutating shared state per call.
    const embeddingParams = {
      apiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
      model: this.config.get('GEMINI_EMBEDDING_MODEL', { infer: true }),
      outputDimensionality: EMBEDDING_DIMENSIONS,
    };
    this.documentEmbeddings = new GoogleGenerativeAIEmbeddings({
      ...embeddingParams,
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });
    this.queryEmbeddings = new GoogleGenerativeAIEmbeddings({
      ...embeddingParams,
      taskType: TaskType.RETRIEVAL_QUERY,
    });
  }

  private chain(temperature: number): ModelSlot[] {
    const slots: ModelSlot[] = [];
    const geminiModel = this.config.get('GEMINI_MODEL', { infer: true });
    slots.push({
      id: `gemini/${geminiModel}`,
      model: new ChatGoogleGenerativeAI({
        apiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
        model: geminiModel,
        temperature,
        maxRetries: 1,
      }),
    });

    const groqKey = this.config.get('GROQ_API_KEY', { infer: true });
    if (groqKey) {
      for (const groqModel of [
        this.config.get('GROQ_MODEL', { infer: true }),
        this.config.get('GROQ_FALLBACK_MODEL', { infer: true }),
      ]) {
        slots.push({
          id: `groq/${groqModel}`,
          model: new ChatGroq({ apiKey: groqKey, model: groqModel, temperature, maxRetries: 1 }),
        });
      }
    }
    return slots;
  }

  /**
   * Runs a prompt that must return data matching `schema`, walking the
   * provider chain until one succeeds.
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

  /** Embeds document chunks. Returns null when the embedding provider is unavailable. */
  async embedDocuments(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];
    try {
      return await this.documentEmbeddings.embedDocuments(texts);
    } catch (error) {
      this.logger.warn(`Document embedding failed, falling back to lexical-only retrieval: ${String(error)}`);
      return null;
    }
  }

  /** Embeds a search query. Returns null when the embedding provider is unavailable. */
  async embedQuery(text: string): Promise<number[] | null> {
    try {
      return await this.queryEmbeddings.embedQuery(text);
    } catch (error) {
      this.logger.warn(`Query embedding failed, using lexical-only retrieval: ${String(error)}`);
      return null;
    }
  }
}
