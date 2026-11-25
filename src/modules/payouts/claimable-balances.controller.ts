import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClaimableBalancesService } from './claimable-balances.service';

@ApiTags('payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ClaimableBalancesController {
  constructor(private readonly claimable: ClaimableBalancesService) {}

  @Get('payouts/claimable-balances')
  @Roles(UserRole.RECRUITER)
  @ApiOperation({ summary: 'Payments held as claimable balances because the wallet lacked a trustline' })
  mine(@CurrentUser() user: { id: string; stellarAddress?: string | null }) {
    return this.claimable.listForUser(user.id, user.stellarAddress);
  }

  @Get('admin/claimable-balances')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'All unclaimed claimable balances (ADMIN only)' })
  unclaimed() {
    return this.claimable.listUnclaimed();
  }
}
