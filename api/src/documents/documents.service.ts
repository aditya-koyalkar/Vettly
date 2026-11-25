import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, type DocumentKind } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { QUEUES, type DocumentIngestJob } from '../queues.js';
import type { CreateDocument, SearchDocuments } from './documents.schemas.js';
import { RetrievalService } from './retrieval.service.js';
import { extractText, normalizeText } from './text-extraction.js';

const documentSummary = {
  id: true,
  kind: true,
  title: true,
  fileName: true,
  status: true,
  error: true,
  profile: true,
  createdAt: true,
  _count: { select: { chunks: true } },
} satisfies Prisma.DocumentSelect;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    @InjectQueue(QUEUES.documentIngest) private readonly ingestQueue: Queue<DocumentIngestJob>,
  ) {}

  async create(userId: string, input: CreateDocument, file?: Express.Multer.File) {
    let rawText: string;
    if (file) {
      rawText = await extractText(file.buffer, file.mimetype, file.originalname);
    } else if (input.text && input.text.length >= 50) {
      rawText = normalizeText(input.text);
    } else {
      throw new BadRequestException('Attach a file or paste at least 50 characters of text.');
    }

    const document = await this.prisma.document.create({
      data: {
        userId,
        kind: input.kind,
        title: input.title || file?.originalname.replace(/\.[^.]+$/, '') || defaultTitle(input.kind),
        fileName: file?.originalname,
        mimeType: file?.mimetype,
        rawText,
      },
      select: documentSummary,
    });

    await this.ingestQueue.add('ingest', { documentId: document.id }, { jobId: `ingest:${document.id}` });
    return document;
  }

  list(userId: string, kind?: DocumentKind) {
    return this.prisma.document.findMany({
      where: { userId, kind },
      orderBy: { createdAt: 'desc' },
      select: documentSummary,
    });
  }

  async get(userId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, userId },
      select: { ...documentSummary, rawText: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    try {
      await this.prisma.document.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('This document is used by an interview session and cannot be deleted.');
      }
      throw error;
    }
  }

  async search(userId: string, input: SearchDocuments) {
    const owned = await this.prisma.document.count({ where: { userId, id: { in: input.documentIds } } });
    if (owned !== input.documentIds.length) throw new NotFoundException('Document not found');
    return this.retrieval.search(input.query, { documentIds: input.documentIds, limit: input.limit });
  }
}

function defaultTitle(kind: DocumentKind) {
  return kind === 'RESUME' ? 'Resume' : 'Job description';
}
