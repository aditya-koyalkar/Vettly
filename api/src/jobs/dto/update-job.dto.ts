import { IsEnum, IsOptional, IsString } from 'class-validator';
import { JobStatus } from '@prisma/client';

export class UpdateJobDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  requirements?: any;

  @IsOptional()
  @IsString()
  experience?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsEnum(JobStatus, { message: 'Invalid job status' })
  status?: JobStatus;
}
