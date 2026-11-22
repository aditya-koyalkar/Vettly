import { IsOptional, IsString } from 'class-validator';

export class RegenerateQuestionDto {
  @IsOptional()
  @IsString()
  instructions?: string;
}
