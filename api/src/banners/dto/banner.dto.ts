import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Admin creates a home banner (image already uploaded via /uploads/image). */
export class CreateBannerDto {
  @IsString()
  imageUrl!: string;

  /** Canonical city names to target. Omit / empty = all cities. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cities?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Admin edits a banner (all fields optional; only provided ones change). */
export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cities?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
