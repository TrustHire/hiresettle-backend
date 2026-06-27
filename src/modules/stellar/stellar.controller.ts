import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { StellarService } from '../../common/stellar/stellar.service';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

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
}
