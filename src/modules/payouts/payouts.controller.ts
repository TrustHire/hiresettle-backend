import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WithdrawChallengeDto, WithdrawDto } from './dto/withdraw.dto';
import { PayoutsService } from './payouts.service';

@ApiTags('payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RECRUITER)
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('anchors')
  @ApiOperation({ summary: 'List SEP-24 anchors available for cashing out to local fiat' })
  listAnchors() {
    return this.payouts.listAnchors();
  }

  @Post('withdraw/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a SEP-10 challenge from the anchor for the recruiter wallet to sign',
    description: 'Sign the returned `transaction` in the wallet, then pass it to POST /payouts/withdraw.',
  })
  createChallenge(@CurrentUser('id') userId: string, @Body() dto: WithdrawChallengeDto) {
    return this.payouts.createChallenge(userId, dto.anchorId);
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Start a SEP-24 interactive withdrawal and return the anchor's interactive URL",
    description:
      'Open `interactiveUrl` in a popup/webview. Once the anchor reports PENDING_USER_TRANSFER, send the ' +
      'asset to `withdrawAnchorAccount` with `withdrawMemo` (GET /payouts/:id). Status is polled automatically.',
  })
  @ApiResponse({ status: 201, description: 'Payout created; includes interactiveUrl' })
  @ApiResponse({ status: 502, description: 'Anchor unreachable or rejected the request' })
  withdraw(@CurrentUser('id') userId: string, @Body() dto: WithdrawDto) {
    return this.payouts.withdraw(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the recruiter's withdrawals" })
  list(@CurrentUser('id') userId: string) {
    return this.payouts.list(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one withdrawal, including the transfer instructions from the anchor' })
  get(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.get(userId, id);
  }
}
