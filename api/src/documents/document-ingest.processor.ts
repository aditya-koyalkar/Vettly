import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { QUEUES, type DocumentIngestJob } from '../queues.js';
import { JdAnalystAgent } from '../agents/jd-analyst.agent.js';
import { ResumeAnalystAgent } from '../agents/resume-analyst.agent.js';
import { chunkDocument } from './chunker.js';
import { RetrievalService } from './retrieval.service.js';

/**
 * Ingest pipeline: chunk → embed/index → structured profile extraction.
 * Indexing and extraction are independent, so they run concurrently.
 */
@Processor(QUEUES.documentIngest, { concurrency: 4 })
export class DocumentIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentIngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly resumeAnalyst: ResumeAnalystAgent,
    private readonly jdAnalyst: JdAnalystAgent,
  ) {
    super();
  }

  async process(job: Job<DocumentIngestJob>) {
    const document = await this.prisma.document.findUnique({ where: { id: job.data.documentId } });
    if (!document) return;

    const chunks = chunkDocument(document.rawText);
    const [{ embedded }, profile] = await Promise.all([
      this.retrieval.indexChunks(document.id, document.userId, chunks),
      document.kind === 'RESUME' ? this.resumeAnalyst.run(document.rawText) : this.jdAnalyst.run(document.rawText),
    ]);

    await this.prisma.document.update({
      where: { id: document.id },
      data: { status: 'READY', error: null, profile: profile.data },
    });
    this.logger.log(`Indexed ${document.kind} ${document.id}: ${chunks.length} chunks, embedded=${embedded}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<DocumentIngestJob>, error: Error) {
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await this.prisma.document.update({
      where: { id: job.data.documentId },
      data: { status: 'FAILED', error: 'We could not analyse this document. Please try again.' },
    });
    this.logger.error(`Ingest failed for ${job.data.documentId}: ${error.message}`);
  }
}
