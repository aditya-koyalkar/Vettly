import { Injectable } from '@nestjs/common';
import { LlmService, type StructuredResult } from '../llm/llm.service.js';
import { DATA_GUARD, asData } from './prompt-utils.js';
import { fitAnalysisSchema, type FitAnalysis, type JobProfile, type ResumeProfile } from './schemas.js';

export interface RequirementEvidence {
  requirement: string;
  /** Resume excerpts retrieved for this requirement (may be empty). */
  excerpts: string[];
}

/**
 * Compares candidate and role. Grounded by RAG: for each requirement it sees
 * the resume excerpts retrieval surfaced, so claims cite real evidence.
 */
@Injectable()
export class FitAnalystAgent {
  constructor(private readonly llm: LlmService) {}

  run(input: {
    resume: ResumeProfile;
    job: JobProfile;
    evidence: RequirementEvidence[];
  }): Promise<StructuredResult<FitAnalysis>> {
    const evidenceBlock = input.evidence
      .map(
        (e) =>
          `Requirement: ${e.requirement}\n` +
          (e.excerpts.length ? e.excerpts.map((x) => `  - ${x.replace(/\s+/g, ' ')}`).join('\n') : '  (no matching resume evidence)'),
      )
      .join('\n\n');

    return this.llm.structured(
      fitAnalysisSchema,
      [
        {
          role: 'system',
          content: [
            'You are a candid career coach preparing a candidate for a specific interview.',
            'Judge fit strictly from the evidence provided. A requirement with no evidence is a gap.',
            'Be specific: cite the evidence that supports each strength. Address the candidate as "you".',
            DATA_GUARD,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            asData('job_profile', JSON.stringify(input.job)),
            asData('candidate_profile', JSON.stringify(input.resume)),
            asData('retrieved_evidence', evidenceBlock),
          ].join('\n\n'),
        },
      ],
      { name: 'fit_analysis', temperature: 0.2 },
    );
  }
}
