import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PublicUserDto } from './dto/public-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UsersService } from './users.service';

// Stellar public key: G + 55 base32 uppercase chars = 56 chars total
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':stellarAddress')
  @ApiOperation({ summary: 'Look up public profile by Stellar address (no auth required)' })
  @ApiParam({ name: 'stellarAddress', example: 'GABC...XYZ', description: 'Stellar public key (56 chars, starts with G)' })
  @ApiResponse({ status: 200, description: 'Public profile retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address format' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getPublicProfile(@Param('stellarAddress') stellarAddress: string): Promise<PublicUserDto> {
    if (!STELLAR_ADDRESS_RE.test(stellarAddress)) {
      throw new BadRequestException('Invalid Stellar address format');
    }
    return this.usersService.findByStellarAddress(stellarAddress);
  }

  @Get('me/notification-preferences')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get notification preferences for current user' })
  @ApiResponse({ status: 200, description: 'Preferences retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getPreferences(@CurrentUser('id') userId: string) {
    return this.usersService.getPreferences(userId);
  }

  @Put('me/notification-preferences')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update notification preferences (bulk)' })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(userId, dto);
  }
}
