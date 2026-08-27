import { SetMetadata } from '@nestjs/common';

export const MAINTENANCE_MODE_BYPASS_KEY = 'maintenanceModeBypass';

export const AllowDuringMaintenance = () =>
  SetMetadata(MAINTENANCE_MODE_BYPASS_KEY, true);