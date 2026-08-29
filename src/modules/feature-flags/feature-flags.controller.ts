import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FeatureFlagsService } from './feature-flags.service';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';

@ApiTags('admin/feature-flags')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all feature flags' })
  @ApiResponse({ status: 200, description: 'Returns a list of all feature flags.' })
  async getAllFlags() {
    return this.featureFlagsService.getAllFlags();
  }

  @Put(':name')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a feature flag' })
  @ApiResponse({ status: 200, description: 'The feature flag has been successfully updated.' })
  async setFlag(
    @Param('name') name: string,
    @Body() dto: UpdateFeatureFlagDto,
  ) {
    return this.featureFlagsService.setFlag(name, dto.isEnabled, dto.description);
  }
}
