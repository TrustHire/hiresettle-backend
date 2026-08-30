import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BulkUpdateMilestoneStatusDto } from './dto/bulk-update-milestone-status.dto';
import { MilestonesService } from './milestones.service';

// Issue #262 — Bulk milestone status update
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/milestones')
export class AdminMilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Patch('bulk-status')
  @ApiOperation({ summary: 'Bulk update milestone status as an admin, applying valid transitions only (#262)' })
  @ApiResponse({ status: 200, description: 'Per-milestone success/failure results' })
  @ApiResponse({ status: 400, description: 'Invalid bulk status update request' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  bulkUpdateStatus(
    @Body() dto: BulkUpdateMilestoneStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.milestonesService.bulkUpdateMilestoneStatus(
      dto.milestoneIds,
      dto.status,
      dto.reason,
      adminId,
    );
  }
}
