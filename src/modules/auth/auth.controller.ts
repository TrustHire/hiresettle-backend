// auth.controller.ts
import { Controller, Post, Get, Patch, Body, Query, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RateLimit } from '../../common/decorators/throttle.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Get('challenge')
  @ApiOperation({ summary: 'Get a challenge nonce for a Stellar address (5 min TTL)' })
  getChallenge(@Query('address') address: string) {
    const nonce = this.authService.generateNonce(address);
    return { nonce, address };
  }

  // Backward-compatible alias
  @Get('nonce')
  @ApiOperation({ summary: 'Get a challenge nonce for a Stellar address' })
  getNonce(@Query('address') address: string) {
    const nonce = this.authService.generateNonce(address);
    return { nonce, address };
  }

  @Post('wallet-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit signed nonce and receive a JWT' })
  @RateLimit(10, 60) // 10 req/min per IP
  walletLogin(@Body() dto: LoginDto) {
    return this.authService.walletLogin(dto);
  }

  // Backward-compatible alias
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit signed nonce and receive a JWT (legacy)' })
  @RateLimit(10, 60)
  login(@Body() dto: LoginDto) {
    return this.authService.walletLogin(dto);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update authenticated user configuration profile properties' })
  async updateMe(@Request() req: any, @Body() dto: UpdateProfileDto) {
    // req.user.id comes from the JwtAuthGuard context session injection
    return this.authService.updateProfile(req.user.id, dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token and receive a new JWT pair' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}



