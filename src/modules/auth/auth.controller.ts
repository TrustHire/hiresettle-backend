import { Controller, Post, Get, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus, UseGuards, Request, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { AuthService, RequestMeta } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { EnableTotpDto, DisableTotpDto } from './dto/totp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RateLimit } from '../../common/decorators/throttle.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

function requestMeta(req: ExpressRequest): RequestMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new account with email/password' })
  @RateLimit(10, 60)
  @ApiResponse({ status: 201, description: 'Registration successful, JWT pair returned' })
  @ApiResponse({ status: 400, description: 'Password policy unmet or invalid Stellar address' })
  @ApiResponse({ status: 409, description: 'Email or Stellar address already registered' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('password/reset')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password (requires current password; enforces complexity policy)' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'Password policy unmet' })
  @ApiResponse({ status: 401, description: 'Unauthorized or incorrect current password' })
  resetPassword(@Request() req: any, @Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(req.user.id, dto.currentPassword, dto.newPassword);
  }

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
  walletLogin(@Body() dto: LoginDto, @Req() req: ExpressRequest) {
    return this.authService.walletLogin(dto, requestMeta(req));
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
  login(@Body() dto: LoginDto, @Req() req: ExpressRequest) {
    return this.authService.walletLogin(dto, requestMeta(req));
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
  logout(@Body() dto: RefreshTokenDto, @Req() req: ExpressRequest) {
    return this.authService.logout(dto.refreshToken, requestMeta(req));
  }

  @Get('sessions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List active refresh token sessions' })
  @ApiResponse({ status: 200, description: 'Sessions retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSessions(@Request() req: any) {
    return this.authService.getSessions(req.user.id);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke a specific refresh token session' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - can only revoke own sessions' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async revokeSession(
    @Request() req: any,
    @Param('id') sessionId: string,
    @Body() body?: RevokeSessionDto,
  ) {
    return this.authService.revokeSession(sessionId, req.user.id, body?.currentRefreshToken);
  }

  @Post('2fa/generate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate TOTP secret for 2FA enrollment' })
  @ApiResponse({ status: 200, description: 'TOTP secret generated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: '2FA already enabled' })
  async generateTotpSecret(@Request() req: any) {
    return this.authService.generateTotpSecret(req.user.id);
  }

  @Post('2fa/enable')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Enable 2FA with TOTP code verification' })
  @ApiResponse({ status: 200, description: '2FA enabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid request or TOTP code' })
  async enableTotp(@Request() req: any, @Body() dto: EnableTotpDto) {
    return this.authService.enableTotp(req.user.id, dto.code);
  }

  @Post('2fa/disable')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disable 2FA with TOTP code verification' })
  @ApiResponse({ status: 200, description: '2FA disabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid request or TOTP code' })
  async disableTotp(@Request() req: any, @Body() dto: DisableTotpDto) {
    return this.authService.disableTotp(req.user.id, dto.code);
  }
}
