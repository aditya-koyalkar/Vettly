import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateCandidateDto {
  @IsEmail({}, { message: 'Valid email is required' })
  @IsNotEmpty({ message: 'Candidate email is required' })
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
