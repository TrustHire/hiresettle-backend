import { Controller, Get, Req, Res, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  private readonly allowedIps: string[];

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('METRICS_ALLOWED_IPS', '');
    this.allowedIps = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  @Get()
  async getMetrics(@Req() req: Request, @Res() res: Response) {
    if (this.allowedIps.length > 0) {
      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        req.socket.remoteAddress ??
        '';
      if (!this.allowedIps.includes(clientIp)) {
        throw new ForbiddenException('Access denied');
      }
    }

    const body = await this.metrics.getMetrics();
    res.set('Content-Type', this.metrics.getContentType());
    res.end(body);
  }
}
