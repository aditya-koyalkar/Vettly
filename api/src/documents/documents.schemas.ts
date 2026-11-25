import { z } from 'zod';

export const documentKindSchema = z.enum(['RESUME', 'JOB_DESCRIPTION']);

/** Multipart fields arrive as strings; `text` is used when no file is attached. */
export const createDocumentSchema = z.object({
  kind: documentKindSchema,
  title: z.string().trim().max(160).optional(),
  text: z.string().trim().max(60_000).optional(),
});
export type CreateDocument = z.infer<typeof createDocumentSchema>;

export const listDocumentsSchema = z.object({
  kind: documentKindSchema.optional(),
});
export type ListDocuments = z.infer<typeof listDocumentsSchema>;

export const searchDocumentsSchema = z.object({
  query: z.string().trim().min(2).max(500),
  documentIds: z.array(z.uuid()).min(1).max(10),
  limit: z.number().int().min(1).max(20).default(6),
});
export type SearchDocuments = z.infer<typeof searchDocumentsSchema>;
