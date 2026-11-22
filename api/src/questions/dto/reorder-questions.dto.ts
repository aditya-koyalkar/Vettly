import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsNotEmpty, IsString, Max, Min, ValidateNested } from 'class-validator';

export class QuestionOrderItem {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  order!: number;
}

export class ReorderQuestionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => QuestionOrderItem)
  orders!: QuestionOrderItem[];
}
