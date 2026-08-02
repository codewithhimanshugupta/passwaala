import { IsString, MaxLength, MinLength } from 'class-validator';

/** CreateCategoryDto — body for POST /categories (shopkeeper adds a category). */
export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}
