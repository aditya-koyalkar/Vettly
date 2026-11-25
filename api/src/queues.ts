/** BullMQ queue names. Each queue has exactly one processor. */
export const QUEUES = {
  documentIngest: 'document-ingest',
  sessionPrep: 'session-prep',
  sessionAnalysis: 'session-analysis',
} as const;

export interface DocumentIngestJob {
  documentId: string;
}

export interface SessionJob {
  sessionId: string;
}
