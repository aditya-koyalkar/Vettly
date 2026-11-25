import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '../queues.js';
import { AgentsModule } from '../agents/agents.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { InternalSessionsController } from './internal/internal.controller.js';
import { InterviewRuntimeService } from './internal/interview-runtime.service.js';
import { LiveKitService } from './livekit.service.js';
import { AnalysisGraph } from './analysis.graph.js';
import { PrepGraph } from './prep.graph.js';
import { SessionAnalysisProcessor } from './session-analysis.processor.js';
import { SessionPrepProcessor } from './session-prep.processor.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUES.sessionPrep }, { name: QUEUES.sessionAnalysis }),
    AgentsModule,
    DocumentsModule,
  ],
  controllers: [SessionsController, InternalSessionsController],
  providers: [
    SessionsService,
    LiveKitService,
    InterviewRuntimeService,
    PrepGraph,
    SessionPrepProcessor,
    AnalysisGraph,
    SessionAnalysisProcessor,
  ],
})
export class SessionsModule {}
