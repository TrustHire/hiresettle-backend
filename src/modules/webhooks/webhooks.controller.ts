import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import axios from 'axios';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { signWebhookBody } from './webhook-signing.util';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get('events')
  @ApiOperation({ summary: 'List the platform-supported webhook event types' })
  @ApiResponse({ status: 200, description: 'Supported events and payload examples' })
  listEvents() {
    return this.webhooks.listSupportedEvents();
  }

  @Post('billing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle a payment-provider webhook delivery' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async handleBillingWebhook(@Req() req: Request) {
    const rawBody = this.extractRawBody(req);
    const signature = this.webhooks.getProviderSignatureHeader(req.headers as Record<string, string | string[] | undefined>);
    const secret = process.env.BILLING_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || 'development-secret';

    if (!this.webhooks.verifyProviderSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid billing webhook signature');
    }

    const body = typeof rawBody === 'string'
      ? JSON.parse(rawBody)
      : Buffer.isBuffer(rawBody)
        ? JSON.parse(rawBody.toString())
        : (req.body ?? {});
    const providerEventId = body.id ?? body.eventId ?? body.data?.id ?? body.providerEventId;
    const milestoneId = body.milestoneId ?? body.data?.milestoneId ?? body.refund?.milestoneId;
    const amount = body.amount ?? body.data?.amount ?? body.refund?.amount;
    const status = body.status === 'completed' || body.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING';

    if (providerEventId) {
      const existing = await this.prisma.refund.findUnique({
        where: { providerEventId },
      });
      if (existing) {
        return { received: true, duplicate: true, refundId: existing.id };
      }
    }

    if (milestoneId) {
      const milestone = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
      if (!milestone) {
        throw new BadRequestException('Refund milestone not found');
      }

      const refund = await this.prisma.refund.upsert({
        where: { milestoneId: milestone.id },
        update: {
          amount: BigInt(amount ?? milestone.amount ?? 0),
          status: status as any,
          reason: body.reason ?? 'Billing provider webhook update',
          providerEventId: providerEventId ?? undefined,
        },
        create: {
          milestoneId: milestone.id,
          amount: BigInt(amount ?? milestone.amount ?? 0),
          status: status as any,
          reason: body.reason ?? 'Billing provider webhook update',
          providerEventId: providerEventId ?? undefined,
        },
      });

      return { received: true, refundId: refund.id, status: refund.status };
    }

    return { received: true, duplicate: !!providerEventId };
  }

  @Post(':id/test')
  @UseGuards(UserJwtSubThrottlerGuard)
  @UseGuards(JwtOrApiKeyGuard)
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Send a signed test payload to a webhook subscription URL' })
  @ApiResponse({ status: 200, description: 'Test payload response status and latency' })
  async testSubscription(@CurrentUser() user: User, @Param('id') id: string) {
    const subscription = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!subscription) {
      throw new BadRequestException('Webhook subscription not found');
    }
    if (subscription.companyId !== user.id) {
      throw new UnauthorizedException('Not authorized to test this subscription');
    }

    const companyUser = await this.prisma.user.findUnique({ where: { id: user.id }, select: { webhookSecret: true } });
    const secret = companyUser?.webhookSecret || 'test-secret';
    const payload = {
      event: 'PING',
      engagementId: 'test-engagement',
      status: 'TEST',
      timestamp: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(payload);
    const started = Date.now();

    try {
      const response = await axios.post(subscription.url, rawBody, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'X-HireSettle-Signature': signWebhookBody(rawBody, secret),
        },
      });
      return {
        subscriptionId: subscription.id,
        status: response.status,
        latencyMs: Date.now() - started,
        ok: response.status >= 200 && response.status < 300,
      };
    } catch (error: any) {
      return {
        subscriptionId: subscription.id,
        status: error?.response?.status ?? 0,
        latencyMs: Date.now() - started,
        ok: false,
        error: error?.message ?? 'Request failed',
      };
    }
  }

  private extractRawBody(req: Request): string | Buffer {
    const raw = (req as any).rawBody;
    if (raw) return raw;
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body;
    return JSON.stringify(req.body ?? {});
  }
}
