import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StellarService } from '../../common/stellar/stellar.service';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { StellarTxStatusService } from './stellar-tx-status.service';
import { FeeSponsorshipService } from './fee-sponsorship.service';
import { SponsoredSubmitDto } from './dto/sponsored-submit.dto';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(
    private readonly stellarService: StellarService,
    private readonly txStatus: StellarTxStatusService,
    private readonly feeSponsorship: FeeSponsorshipService,
  ) {}

  @Get('balance/:address')
  @ApiOperation({ summary: 'Get token balance for a Stellar address' })
  @ApiQuery({ name: 'token', required: false, description: 'Token address (defaults to native XLM)' })
  @ApiResponse({ status: 200, description: 'Token balance retrieved successfully' })
  async getBalance(
    @Param('address') address: string,
    @Query('token') token?: string,
  ) {
    const { balance } = await this.stellarService.getBalance(address, token || 'native');
    return { address, token: token || 'native', balance: balance.toString() };
  }

  @Get('fee-estimate')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(10 * 1000) // Cache for 10 seconds
  @ApiOperation({ summary: 'Get current base fee and recommended Soroban fee' })
  @ApiResponse({ status: 200, description: 'Fee estimate retrieved successfully' })
  async getFeeEstimate() {
    return this.stellarService.getFeeEstimate();
  }

  @Get('tx/:hash')
  @ApiOperation({ summary: 'Get Stellar transaction status with decoded result codes' })
  @ApiResponse({ status: 200, description: 'Transaction status (pending | success | failed)' })
  @ApiResponse({ status: 404, description: 'Transaction not found on Horizon' })
  async getTxStatus(@Param('hash') hash: string) {
    return this.txStatus.getStatus(hash);
  }

  @Post('tx/sponsored')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a user-signed tx, fee-bumped by the platform when ENABLE_FEE_SPONSORSHIP=true' })
  async submitSponsored(@Body() dto: SponsoredSubmitDto) {
    return this.feeSponsorship.submit(dto.xdr, dto.companyId);
  }
}
