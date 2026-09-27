import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DisputeStage, UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppealService } from './appeal.service';
import { DisputesService } from './disputes.service';
import { DisputeDecisionDto } from './dto/dispute-decision.dto';
import { OpenAppealDto } from './dto/open-appeal.dto';

@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disputes: DisputesService,
    private readonly appeals: AppealService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Dispute detail, including SLA response deadline and appeal window' })
  @ApiResponse({ status: 200, description: 'Dispute detail' })
  @ApiResponse({ status: 403, description: 'Not a party to this dispute' })
  @ApiResponse({ status: 404, description: 'Dispute not found' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.disputes.findOneForUser(id, user);
  }

  @Post(':id/appeal')
  @ApiOperation({ summary: 'Appeal a dispute decision (company or recruiter, once, within the appeal window)' })
  @ApiResponse({ status: 201, description: 'Appeal opened; funds stay locked until it is decided' })
  @ApiResponse({ status: 403, description: 'Not the company or recruiter on this engagement' })
  @ApiResponse({ status: 409, description: 'Already appealed, or the decision is final' })
  @ApiResponse({ status: 422, description: 'No decision to appeal, or the appeal window has closed' })
  appeal(@Param('id') id: string, @Body() dto: OpenAppealDto, @CurrentUser() user: any) {
    return this.appeals.openAppeal(id, user, dto.reason);
  }

  @Post(':id/decision')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ARBITER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Decide a dispute or its appeal (assigned arbiter only)' })
  @ApiResponse({ status: 201, description: 'Decision recorded' })
  @ApiResponse({ status: 403, description: 'Not the assigned arbiter' })
  @ApiResponse({ status: 409, description: 'Dispute is not awaiting a decision' })
  async decide(@Param('id') id: string, @Body() dto: DisputeDecisionDto, @CurrentUser() user: any) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException(`Dispute ${id} not found`);
    if (dispute.stage === DisputeStage.APPEAL_REVIEW) {
      return this.appeals.decideAppeal(id, user, dto.outcome);
    }
    return this.disputes.decide(dispute, dto.outcome, user);
  }
}
