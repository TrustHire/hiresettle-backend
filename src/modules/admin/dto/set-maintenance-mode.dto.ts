import { IsBoolean } from 'class-validator';

export class SetMaintenanceModeDto {
  @IsBoolean()
  enabled: boolean;
}