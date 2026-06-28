import { Controller, Get, Delete, Post, Param, Query, UseGuards, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminUsersService } from './admin-users.service';
import { ListUsersDto } from './dto/list-users.dto';
import { AssignArbiterDto } from './dto/assign-arbiter.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get('users')
  @ApiOperation({ summary: 'List / search users (admin only)' })
  @ApiResponse({ status: 200, description: 'Users list retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminUsers.listUsers(dto);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Deactivate a user (soft delete)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  deactivateUser(@Param('id') id: string) {
    return this.adminUsers.deactivateUser(id);
  }

  @Post('users/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User reactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User already active' })
  reactivateUser(@Param('id') id: string) {
    return this.adminUsers.reactivateUser(id);
  }

  @Patch('engagements/:id/arbiter')
  @ApiOperation({ summary: 'Assign or reassign an arbiter to an engagement' })
  assignArbiter(@Param('id') id: string, @Body() dto: AssignArbiterDto) {
    return this.adminUsers.assignArbiter(id, dto.arbiterId);
  }

  @Get('arbiters')
  @ApiOperation({ summary: 'List all active arbiters' })
  listArbiters() {
    return this.adminUsers.listArbiters();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get admin metrics including arbiter workload' })
  getMetrics() {
    return this.adminUsers.getAdminMetrics();
  }
}
