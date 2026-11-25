import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '../queues.js';
import { AgentsModule } from '../agents/agents.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { DocumentIngestProcessor } from './document-ingest.processor.js';
import { RetrievalService } from './retrieval.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.documentIngest }), AgentsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, RetrievalService, DocumentIngestProcessor],
  exports: [RetrievalService],
})
export class DocumentsModule {}
