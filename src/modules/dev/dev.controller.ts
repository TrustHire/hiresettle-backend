import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FriendbotService } from './friendbot.service';

@ApiTags('dev')
@Controller('dev')
export class DevController {
  constructor(private readonly friendbot: FriendbotService) {}

  @Post('friendbot/fund')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate and fund a testnet account via Friendbot (dev only)' })
  @ApiResponse({ status: 403, description: 'Blocked on mainnet / production' })
  fund() {
    return this.friendbot.fund();
  }
}
