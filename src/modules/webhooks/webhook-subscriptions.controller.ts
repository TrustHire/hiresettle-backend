import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from "@nestjs/swagger";
import { User, UserRole } from "@prisma/client";
import { IsDateString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { WebhookSubscriptionsService } from "./webhook-subscriptions.service";
import { WebhooksService } from "./webhooks.service";
import { CreateWebhookSubscriptionDto } from "./dto/create-webhook-subscription.dto";
import { JwtOrApiKeyGuard } from "../../common/guards/jwt-or-api-key.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserJwtSubThrottlerGuard } from "../../common/guards/user-jwt-sub-throttler.guard";
import { Idempotent } from "../../common/decorators/idempotent.decorator";
import { IdempotencyInterceptor } from "../../common/interceptors/idempotency.interceptor";
import { PrismaService } from "../../common/prisma/prisma.service";

class ReplayWebhookDto {
  @ApiProperty({ example: "2026-08-01T00:00:00.000Z" })
  @IsDateString()
  from: string;

  @ApiProperty({ example: "2026-08-29T23:59:59.999Z" })
  @IsDateString()
  to: string;
}

@ApiTags("webhooks")
@ApiBearerAuth()
@ApiSecurity("api-key")
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtOrApiKeyGuard)
@UseGuards(RolesGuard)
@Roles(UserRole.COMPANY)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller("webhooks/subscriptions")
export class WebhookSubscriptionsController {
  constructor(
    private readonly subscriptionsService: WebhookSubscriptionsService,
    private readonly webhooksService: WebhooksService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      "Register a webhook subscription URL (COMPANY only; JWT or X-Api-Key)",
  })
  @ApiResponse({ status: 201, description: "Subscription created" })
  @ApiResponse({ status: 400, description: "Invalid URL (must be https)" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  create(@CurrentUser() user: User, @Body() dto: CreateWebhookSubscriptionDto) {
    return this.subscriptionsService.create(user.id, dto.url, dto.eventTypes);
  }

  @Get()
  @ApiOperation({
    summary:
      "List webhook subscriptions for the current company (JWT or X-Api-Key)",
  })
  @ApiResponse({ status: 200, description: "Subscriptions retrieved" })
  findAll(@CurrentUser() user: User) {
    return this.subscriptionsService.findAll(user.id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Remove a webhook subscription (JWT or X-Api-Key)" })
  @ApiResponse({ status: 200, description: "Subscription removed" })
  @ApiResponse({
    status: 403,
    description: "Not authorized to remove this subscription",
  })
  @ApiResponse({ status: 404, description: "Subscription not found" })
  remove(@CurrentUser() user: User, @Param("id") id: string) {
    return this.subscriptionsService.remove(id, user.id);
  }

  @Post(":id/replay")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Replay historical webhook delivery logs within a date range (#274)",
  })
  @ApiResponse({ status: 200, description: "Replayed events count" })
  @ApiResponse({ status: 400, description: "Invalid date range" })
  @ApiResponse({ status: 403, description: "Not authorized" })
  @ApiResponse({ status: 404, description: "Subscription not found" })
  async replay(
    @CurrentUser() user: User,
    @Param("id") id: string,
    @Body() dto: ReplayWebhookDto,
  ) {
    const companyUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { webhookSecret: true },
    });
    return this.subscriptionsService.replay(
      id,
      user.id,
      new Date(dto.from),
      new Date(dto.to),
      this.webhooksService,
      companyUser?.webhookSecret ?? undefined,
    );
  }
}
