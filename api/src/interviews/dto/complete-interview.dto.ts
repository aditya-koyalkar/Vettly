import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { InterviewStatus } from '@prisma/client';

export class CompleteInterviewDto {
  @IsString()
  @IsNotEmpty()
  interviewId!: string;

  @IsInt()
  durationSeconds!: number;

  @IsArray()
  transcript!: any[];

  @IsOptional()
  @IsEnum(InterviewStatus)
  status?: InterviewStatus;
}
