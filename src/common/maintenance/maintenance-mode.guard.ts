import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MaintenanceModeService } from './maintenance-mode.service';
import { MAINTENANCE_MODE_BYPASS_KEY } from './maintenance-mode.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(
    private readonly maintenanceMode: MaintenanceModeService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (READ_METHODS.has(request.method)) return true;

    const bypass = this.reflector.getAllAndOverride<boolean>(
      MAINTENANCE_MODE_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (bypass || !(await this.maintenanceMode.isEnabled())) return true;

    throw new ServiceUnavailableException(
      'The API is in maintenance mode. Write operations are temporarily unavailable.',
    );
  }
}