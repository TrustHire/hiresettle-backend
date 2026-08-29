import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StellarService } from './stellar.service';

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

  @Get('tokens')
  @ApiOperation({ summary: 'List allowed Stellar tokens with metadata' })
  getTokens() {
    return this.stellarService.getAllowedTokens();
  }
}
