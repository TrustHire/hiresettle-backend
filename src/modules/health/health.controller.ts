import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, HealthCheck, MemoryHealthIndicator, DiskHealthIndicator } from '@nestjs/terminus';
import { HealthService } from './health.service';
import { QueueHealthIndicator } from './queue-health.indicator';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private healthService: HealthService,
    private queueHealth: QueueHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe — process only, no external dependencies' })
  live() {
    // No indicators: the route being reachable proves the process is up.
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — checks DB, Horizon, Redis/queues, memory, disk' })
  ready() {
    return this.health.check([
      () => this.healthService.isDatabaseHealthy(),
      () => this.healthService.isStellarHorizonHealthy(),
      () => this.queueHealth.isHealthy(),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
      () => this.disk.checkStorage('disk_storage', { path: '/', thresholdPercent: 0.75 }),
    ]);
  }

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  check() {
    return this.health.check([
      () => this.healthService.isDatabaseHealthy(),
      () => this.healthService.isStellarHorizonHealthy(),
      () => this.queueHealth.isHealthy(),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024), // 150MB
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),   // 150MB
      () => this.disk.checkStorage('disk_storage', { path: '/', thresholdPercent: 0.75 }),
    ]);
  }
}
