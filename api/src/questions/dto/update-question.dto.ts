import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  evaluation?: any;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  order?: number;
}
