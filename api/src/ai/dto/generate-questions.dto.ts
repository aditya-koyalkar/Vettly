import { IsOptional, IsString } from 'class-validator';

export class GenerateQuestionsDto {
  @IsOptional()
  @IsString()
  prompt?: string;
}
