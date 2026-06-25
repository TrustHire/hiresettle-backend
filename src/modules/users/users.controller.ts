import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('notification-preferences')
  @ApiOperation({ summary: 'Get notification preferences for current user' })
  getPreferences(@CurrentUser('id') userId: string) {
    return this.usersService.getPreferences(userId);
  }

  @Put('notification-preferences')
  @ApiOperation({ summary: 'Update notification preferences (bulk)' })
  updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(userId, dto);
  }
}
