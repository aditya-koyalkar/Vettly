import { Injectable } from '@nestjs/common';
import { LlmService, type StructuredResult } from '../llm/llm.service.js';
import { DATA_GUARD, asData, truncate } from './prompt-utils.js';
import { resumeProfileSchema, type ResumeProfile } from './schemas.js';

/** Extracts a structured candidate profile from raw resume text. */
@Injectable()
export class ResumeAnalystAgent {
  constructor(private readonly llm: LlmService) {}

  run(resumeText: string): Promise<StructuredResult<ResumeProfile>> {
    return this.llm.structured(
      resumeProfileSchema,
      [
        {
          role: 'system',
          content: [
            'You are a meticulous technical recruiter who extracts structured facts from resumes.',
            'Only record what the resume states or directly implies; never invent employers, dates or metrics.',
            'Preserve numbers and outcomes verbatim in highlights.',
            DATA_GUARD,
          ].join('\n'),
        },
        { role: 'user', content: asData('resume', truncate(resumeText)) },
      ],
      { name: 'resume_profile', temperature: 0 },
    );
  }
}
