import { Controller, Post, Get, Patch, Body, Query, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
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
  @ApiQuery({ name: 'address', description: 'Stellar public key', example: 'GABC...XYZ' })
  @ApiResponse({ status: 200, description: 'Challenge nonce generated' })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address format' })
  getChallenge(@Query('address') address: string) {
    const nonce = this.authService.generateNonce(address);
    return { nonce, address };
  }

  // Backward-compatible alias
  @Get('nonce')
  @ApiOperation({ summary: 'Get a challenge nonce for a Stellar address' })
  @ApiQuery({ name: 'address', description: 'Stellar public key', example: 'GABC...XYZ' })
  @ApiResponse({ status: 200, description: 'Challenge nonce generated' })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address format' })
  getNonce(@Query('address') address: string) {
    const nonce = this.authService.generateNonce(address);
    return { nonce, address };
  }

  @Post('wallet-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit signed nonce and receive a JWT' })
  @RateLimit(10, 60) // 10 req/min per IP
  @ApiResponse({ status: 200, description: 'Login successful, JWT returned' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  walletLogin(@Body() dto: LoginDto) {
    return this.authService.walletLogin(dto);
  }

  // Backward-compatible alias
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit signed nonce and receive a JWT (legacy)' })
  @RateLimit(10, 60)
  @ApiResponse({ status: 200, description: 'Login successful, JWT returned' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  login(@Body() dto: LoginDto) {
    return this.authService.walletLogin(dto);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update authenticated user configuration profile properties' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  async updateMe(@Request() req: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token and receive a new JWT pair' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  @ApiResponse({ status: 400, description: 'Invalid refresh token' })
  @ApiResponse({ status: 401, description: 'Invalid token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiResponse({ status: 200, description: 'Token revoked' })
  @ApiResponse({ status: 400, description: 'Invalid refresh token' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
