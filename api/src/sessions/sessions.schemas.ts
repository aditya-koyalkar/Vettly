import { z } from 'zod';

export const createSessionSchema = z.object({
  resumeId: z.uuid(),
  jobDescriptionId: z.uuid(),
  title: z.string().trim().max(160).optional(),
  type: z.enum(['TECHNICAL', 'BEHAVIORAL', 'SYSTEM_DESIGN', 'MIXED']).default('MIXED'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  durationMinutes: z.number().int().min(5).max(60).default(20),
});
export type CreateSession = z.infer<typeof createSessionSchema>;

// ─── Internal API (voice agent → API) ────────────────────────────────────────

export const agentSearchSchema = z.object({
  query: z.string().trim().min(2).max(500),
  scope: z.enum(['resume', 'job', 'both']).default('both'),
});
export type AgentSearch = z.infer<typeof agentSearchSchema>;

export const agentNoteSchema = z.object({
  questionId: z.string().max(20).optional(),
  topic: z.string().trim().min(1).max(200),
  observation: z.string().trim().min(1).max(2000),
  rating: z.number().int().min(1).max(5).optional(),
});
export type AgentNote = z.infer<typeof agentNoteSchema>;

export const agentCompleteSchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(['AGENT', 'CANDIDATE']),
        content: z.string().max(10_000),
        agentName: z.string().max(60).optional(),
        offsetSec: z.number().nonnegative().optional(),
      }),
    )
    .max(2_000),
  endedReason: z.string().max(200).optional(),
});
export type AgentComplete = z.infer<typeof agentCompleteSchema>;
