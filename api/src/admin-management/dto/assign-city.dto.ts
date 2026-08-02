import { IsOptional, IsUUID } from 'class-validator';

export class AssignCityDto {
  @IsOptional()
  @IsUUID()
  cityId?: string | null;
}
