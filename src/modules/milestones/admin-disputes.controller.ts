import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BulkResolveDisputesDto } from './dto/bulk-resolve-disputes.dto';
import { MilestonesService } from './milestones.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Patch('bulk-resolve')
  @ApiOperation({ summary: 'Resolve multiple disputes as an admin' })
  @ApiResponse({ status: 200, description: 'Per-dispute resolution results' })
  @ApiResponse({ status: 400, description: 'Invalid bulk resolution request' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  bulkResolve(@Body() dto: BulkResolveDisputesDto) {
    return this.milestonesService.bulkResolveDisputes(dto.disputeIds, dto.resolution);
  }
}