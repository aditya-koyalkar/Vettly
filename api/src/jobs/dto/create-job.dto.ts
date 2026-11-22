import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JobStatus } from '@prisma/client';

export class CreateJobDto {
  @IsOptional()
  @IsString()
  jobId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Job title is required' })
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'Job description is required' })
  description!: string;

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
