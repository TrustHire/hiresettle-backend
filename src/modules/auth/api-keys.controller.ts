import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeysService } from './api-keys.service';
import { UpdateApiKeyLimitsDto } from './dto/update-api-key-limits.dto';

/** Owner-facing API key endpoints. Admin equivalents live under /admin/api-keys. */
@ApiTags('api-keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List my API keys with their limits and current-month usage' })
  list(@CurrentUser('id') userId: string) {
    return this.apiKeys.list(userId);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Current-month quota usage for one of my API keys' })
  @ApiParam({ name: 'id', description: 'API key ID' })
  usage(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.getUsage(id, userId);
  }

  @Patch(':id/limits')
  @ApiOperation({
    summary: 'Change the rate limit / monthly quota of one of my API keys',
    description:
      'Owners can split capacity across their keys within API_KEY_OWNER_MAX_RATE_LIMIT and ' +
      'API_KEY_OWNER_MAX_MONTHLY_QUOTA. Only admins can exceed those or remove a quota.',
  })
  @ApiParam({ name: 'id', description: 'API key ID' })
  @ApiResponse({ status: 200, description: 'Updated key with current-month usage' })
  @ApiResponse({ status: 400, description: 'Limit above the owner ceiling' })
  @ApiResponse({ status: 403, description: 'Not your API key' })
  updateLimits(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiKeyLimitsDto,
  ) {
    return this.apiKeys.updateLimits(id, dto, userId);
  }
}
