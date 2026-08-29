import { Controller, Get, Post, Query, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { WebAuthnRegisterVerifyDto } from './dto/webauthn-register-verify.dto';
import { WebAuthnAuthVerifyDto } from './dto/webauthn-auth-verify.dto';

@ApiTags('auth')
@Controller('auth/webauthn')
export class WebauthnController {
  private readonly logger = new Logger(WebauthnController.name);
  constructor(private readonly authService: AuthService) {}

  @Get('register/options')
  @ApiOperation({ summary: 'Get WebAuthn registration options for a user (passkey registration)' })
  getRegisterOptions(@Query('address') stellarAddress: string) {
    return this.authService.generateWebauthnRegistrationOptions(stellarAddress);
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify WebAuthn attestation response and persist credential' })
  verifyRegistration(@Body() dto: WebAuthnRegisterVerifyDto) {
    return this.authService.verifyWebauthnRegistration(dto);
  }

  @Get('auth/options')
  @ApiOperation({ summary: 'Get WebAuthn authentication options (assertion) for a user' })
  getAuthOptions(@Query('address') stellarAddress: string) {
    return this.authService.generateWebauthnAuthenticationOptions(stellarAddress);
  }

  @Post('auth/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify WebAuthn assertion and return JWT on success' })
  verifyAuthentication(@Body() dto: WebAuthnAuthVerifyDto) {
    return this.authService.verifyWebauthnAuthentication(dto);
  }
}
