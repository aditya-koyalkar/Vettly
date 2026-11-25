import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type DocumentKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import type { Chunk } from './chunker.js';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  kind: DocumentKind;
  section: string | null;
  content: string;
  score: number;
}

export interface SearchOptions {
  documentIds: string[];
  limit?: number;
}

/** Standard RRF damping constant; keeps a single list from dominating. */
const RRF_K = 60;
/** Candidates pulled from each retrieval leg before fusion. */
const CANDIDATES_PER_LEG = 20;

const toVectorLiteral = (embedding: number[]) => `[${embedding.join(',')}]`;

/**
 * Builds an OR-joined tsquery from free text. websearch_to_tsquery ANDs every
 * term, which almost never matches a natural-language question against a
 * short resume chunk.
 */
export function toOrTsQuery(text: string): string | null {
  const terms = [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]{1,}/g) ?? [])]
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 1);
  return terms.length ? terms.join(' | ') : null;
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** Replaces a document's chunks, embedding them when the provider is up. */
  async indexChunks(documentId: string, userId: string, chunks: Chunk[]): Promise<{ embedded: boolean }> {
    const embeddings = await this.llm.embedDocuments(chunks.map((c) => c.content));

    await this.prisma.$transaction([
      this.prisma.documentChunk.deleteMany({ where: { documentId } }),
      ...chunks.map((chunk, i) => {
        const vector = embeddings?.[i] ? Prisma.sql`${toVectorLiteral(embeddings[i])}::vector` : Prisma.sql`NULL`;
        return this.prisma.$executeRaw`
          INSERT INTO "DocumentChunk" ("id", "documentId", "userId", "chunkIndex", "section", "content", "embedding")
          VALUES (${randomUUID()}, ${documentId}, ${userId}, ${chunk.index}, ${chunk.section}, ${chunk.content}, ${vector})`;
      }),
    ]);
    return { embedded: embeddings !== null };
  }

  /**
   * Hybrid search: dense (pgvector cosine) + lexical (Postgres FTS), merged
   * with Reciprocal Rank Fusion. Either leg may be empty; RRF degrades
   * gracefully to the other.
   */
  async search(query: string, { documentIds, limit = 6 }: SearchOptions): Promise<RetrievedChunk[]> {
    if (documentIds.length === 0 || !query.trim()) return [];

    const embedding = await this.llm.embedQuery(query);
    const tsQuery = toOrTsQuery(query);

    const denseLeg = embedding
      ? Prisma.sql`
          SELECT "id", ROW_NUMBER() OVER (ORDER BY "embedding" <=> ${toVectorLiteral(embedding)}::vector) AS rnk
          FROM "DocumentChunk"
          WHERE "documentId" = ANY(${documentIds}::text[]) AND "embedding" IS NOT NULL
          ORDER BY "embedding" <=> ${toVectorLiteral(embedding)}::vector
          LIMIT ${CANDIDATES_PER_LEG}`
      : Prisma.sql`SELECT NULL::text AS "id", NULL::bigint AS rnk WHERE false`;

    const lexicalLeg = tsQuery
      ? Prisma.sql`
          SELECT "id", ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(to_tsvector('english', "content"), to_tsquery('english', ${tsQuery})) DESC
          ) AS rnk
          FROM "DocumentChunk"
          WHERE "documentId" = ANY(${documentIds}::text[])
            AND to_tsvector('english', "content") @@ to_tsquery('english', ${tsQuery})
          LIMIT ${CANDIDATES_PER_LEG}`
      : Prisma.sql`SELECT NULL::text AS "id", NULL::bigint AS rnk WHERE false`;

    return this.prisma.$queryRaw<RetrievedChunk[]>`
      WITH dense AS (${denseLeg}), lexical AS (${lexicalLeg}),
      fused AS (
        SELECT COALESCE(dense."id", lexical."id") AS "id",
               COALESCE(1.0 / (${RRF_K} + dense.rnk), 0) + COALESCE(1.0 / (${RRF_K} + lexical.rnk), 0) AS score
        FROM dense FULL OUTER JOIN lexical ON dense."id" = lexical."id"
      )
      SELECT c."id", c."documentId", d."kind", c."section", c."content", fused.score::float AS score
      FROM fused
      JOIN "DocumentChunk" c ON c."id" = fused."id"
      JOIN "Document" d ON d."id" = c."documentId"
      ORDER BY fused.score DESC
      LIMIT ${limit}`;
  }
}
