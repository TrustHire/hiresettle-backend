import {
  Controller, Get, Post, Body, Param, Delete,
  UseGuards, HttpCode, HttpStatus, UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
} from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@UseGuards(RolesGuard)
@Roles(UserRole.COMPANY)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('webhooks/subscriptions')
export class WebhookSubscriptionsController {
  constructor(private readonly subscriptionsService: WebhookSubscriptionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Register a webhook subscription URL (COMPANY only)' })
  @ApiResponse({ status: 201, description: 'Subscription created' })
  @ApiResponse({ status: 400, description: 'Invalid URL (must be https)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(
    @CurrentUser() user: User,
    @Body() dto: CreateWebhookSubscriptionDto,
  ) {
    return this.subscriptionsService.create(user.id, dto.url);
  }

  @Get()
  @ApiOperation({ summary: 'List webhook subscriptions for the current company' })
  @ApiResponse({ status: 200, description: 'Subscriptions retrieved' })
  findAll(@CurrentUser() user: User) {
    return this.subscriptionsService.findAll(user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a webhook subscription' })
  @ApiResponse({ status: 200, description: 'Subscription removed' })
  @ApiResponse({ status: 403, description: 'Not authorized to remove this subscription' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  remove(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.subscriptionsService.remove(id, user.id);
  }
}
