import { Injectable } from '@nestjs/common';
import { LlmService, type StructuredResult } from '../llm/llm.service.js';
import { DATA_GUARD, asData, truncate } from './prompt-utils.js';
import { jobProfileSchema, type JobProfile } from './schemas.js';

/** Distils a job description into requirements an interviewer can probe. */
@Injectable()
export class JdAnalystAgent {
  constructor(private readonly llm: LlmService) {}

  run(jobText: string): Promise<StructuredResult<JobProfile>> {
    return this.llm.structured(
      jobProfileSchema,
      [
        {
          role: 'system',
          content: [
            'You are a hiring manager who turns job descriptions into crisp, testable requirements.',
            'Separate hard requirements from nice-to-haves. Normalise skill names (e.g. "k8s" -> "Kubernetes").',
            'Infer seniority from scope and years if not stated.',
            DATA_GUARD,
          ].join('\n'),
        },
        { role: 'user', content: asData('job_description', truncate(jobText)) },
      ],
      { name: 'job_profile', temperature: 0 },
    );
  }
}
