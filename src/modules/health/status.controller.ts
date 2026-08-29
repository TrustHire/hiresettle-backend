import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('status')
@Controller('status')
export class StatusController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Public API status summary' })
  async getStatus() {
    const dbStatus = await this.healthService.isDatabaseHealthy();
    const stellarStatus = await this.healthService.isStellarHorizonHealthy();

    const isDbUp = dbStatus.database?.status === 'up';
    const isStellarUp = stellarStatus.stellarHorizon?.status === 'up';

    return {
      status: isDbUp && isStellarUp ? 'up' : 'degraded',
      services: {
        api: 'up',
        database: isDbUp ? 'up' : 'down',
        stellar: isStellarUp ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
