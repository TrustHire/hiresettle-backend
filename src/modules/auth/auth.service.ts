import { Injectable, UnauthorizedException, Logger, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory nonce / challenge stores — replace with Redis in production
  private readonly nonces = new Map<string, { nonce: string; expiresAt: number }>();
  private readonly regChallenges = new Map<string, string>(); // keyed by userId
  private readonly authChallenges = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  generateNonce(stellarAddress: string): string {
    const nonce = `hiresettle:${stellarAddress}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.nonces.set(stellarAddress, {
      nonce,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
    return nonce;
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; user: any }> {
    const { stellarAddress, signedNonce, signature } = dto;

    const stored = this.nonces.get(stellarAddress);
    if (!stored || Date.now() > stored.expiresAt) {
      throw new UnauthorizedException('Nonce expired or not found. Request a new one.');
    }

    // TODO: wire up Keypair.verify() before production
    const isValid = true; // STUB

    if (!isValid) throw new UnauthorizedException('Signature verification failed');

    this.nonces.delete(stellarAddress);

    const user = await this.prisma.user.upsert({
      where: { stellarAddress },
      create: { stellarAddress },
      update: { updatedAt: new Date() },
    });

    const accessToken = this.jwt.sign({
      sub: user.id,
      stellarAddress: user.stellarAddress,
      role: user.role,
    });

    this.logger.log(`User authenticated: ${stellarAddress}`);
    return { accessToken, user };
  }

  // ---------------------- WebAuthn (Passkeys) ----------------------

  /**
   * Generate registration options for a user identified by stellarAddress.
   * Creates the user if not present. Stores the challenge in memory keyed by user.id.
   */
  async generateWebauthnRegistrationOptions(stellarAddress: string) {
    if (!stellarAddress) throw new BadRequestException('stellarAddress is required');

    const user = await this.prisma.user.upsert({
      where: { stellarAddress },
      create: { stellarAddress },
      update: {},
    });

    const rpName = this.config.get<string>('WEBAUTHN_RP_NAME', 'HireSettle');
    const rpID = this.config.get<string>('WEBAUTHN_RP_ID', this.config.get<string>('HOST') || 'localhost');

    const options = generateRegistrationOptions({
      rpName,
      rpID,
      userID: user.id,
      userName: user.stellarAddress,
      attestationType: 'none',
      authenticatorSelection: {
        userVerification: 'required', // require UV for phishing resistance
      },
      // prevent re-registration of same credential IDs on client side
      excludeCredentials: [],
    });

    // store challenge keyed by user id
    this.regChallenges.set(user.id, options.challenge);

    return { options, userId: user.id };
  }

  /**
   * Verify attestation response from client and persist credential.
   */
  async verifyWebauthnRegistration(dto: { stellarAddress: string; attestationResponse: any }) {
    const { stellarAddress, attestationResponse } = dto;
    if (!stellarAddress || !attestationResponse) throw new BadRequestException('Missing fields');

    const user = await this.prisma.user.findUnique({ where: { stellarAddress } });
    if (!user) throw new BadRequestException('User not found');

    const expectedChallenge = this.regChallenges.get(user.id);
    if (!expectedChallenge) throw new BadRequestException('No registration in progress for this user');

    const origin = this.config.get<string>('ORIGIN', `http://localhost:3000`);
    const rpID = this.config.get<string>('WEBAUTHN_RP_ID', this.config.get<string>('HOST') || 'localhost');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: attestationResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
    } catch (err) {
      this.logger.error('Registration verification failed', err as any);
      throw new BadRequestException('Registration verification failed');
    }

    const { verified, registrationInfo } = verification as any;
    if (!verified || !registrationInfo) {
      throw new BadRequestException('Could not verify registration');
    }

    const credentialId = Buffer.from(registrationInfo.credentialID).toString('base64url');
    const publicKey = registrationInfo.credentialPublicKey; // Buffer — store as base64
    const counter = registrationInfo.counter ?? 0;

    // Persist credential
    await this.prisma.credential.create({
      data: {
        userId: user.id,
        credentialId,
        publicKey: Buffer.isBuffer(publicKey) ? publicKey.toString('base64') : String(publicKey),
        counter: Number(counter),
        transports: Array.isArray(attestationResponse.transports) ? attestationResponse.transports.join(',') : undefined,
      },
    });

    // Cleanup
    this.regChallenges.delete(user.id);

    return { ok: true };
  }

  /**
   * Generate authentication (assertion) options for a user.
   */
  async generateWebauthnAuthenticationOptions(stellarAddress: string) {
    if (!stellarAddress) throw new BadRequestException('stellarAddress is required');

    const user = await this.prisma.user.findUnique({ where: { stellarAddress } });
    if (!user) throw new BadRequestException('User not found');

    const creds = await this.prisma.credential.findMany({ where: { userId: user.id } });

    const rpID = this.config.get<string>('WEBAUTHN_RP_ID', this.config.get<string>('HOST') || 'localhost');

    const allowCredentials = creds.map((c) => ({
      id: Buffer.from(c.credentialId, 'base64url'),
      type: 'public-key' as const,
      transports: c.transports ? c.transports.split(',') : undefined,
    }));

    const options = generateAuthenticationOptions({
      allowCredentials,
      userVerification: 'required',
      rpID,
    });

    this.authChallenges.set(user.id, options.challenge);

    return { options, userId: user.id };
  }

  /**
   * Verify assertion response and issue JWT on success.
   */
  async verifyWebauthnAuthentication(dto: { stellarAddress: string; assertionResponse: any }) {
    const { stellarAddress, assertionResponse } = dto;
    if (!stellarAddress || !assertionResponse) throw new BadRequestException('Missing fields');

    const user = await this.prisma.user.findUnique({ where: { stellarAddress } });
    if (!user) throw new BadRequestException('User not found');

    const expectedChallenge = this.authChallenges.get(user.id);
    if (!expectedChallenge) throw new BadRequestException('No authentication in progress for this user');

    // find credential
    const credential = await this.prisma.credential.findUnique({ where: { credentialId: Buffer.from(assertionResponse.id, 'base64').toString('base64url') } });
    if (!credential) throw new BadRequestException('Unknown credential');

    const origin = this.config.get<string>('ORIGIN', `http://localhost:3000`);
    const rpID = this.config.get<string>('WEBAUTHN_RP_ID', this.config.get<string>('HOST') || 'localhost');

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertionResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        authenticator: {
          credentialPublicKey: Buffer.from(credential.publicKey, 'base64'),
          credentialID: Buffer.from(credential.credentialId, 'base64url'),
          counter: credential.counter,
        },
      } as any);
    } catch (err) {
      this.logger.error('Authentication verification failed', err as any);
      throw new BadRequestException('Authentication verification failed');
    }

    const { verified, authenticationInfo } = verification as any;
    if (!verified) throw new BadRequestException('Assertion not verified');

    // Update counter
    if (authenticationInfo && typeof authenticationInfo.newCounter === 'number') {
      await this.prisma.credential.update({ where: { id: credential.id }, data: { counter: Number(authenticationInfo.newCounter) } });
    }

    // Cleanup
    this.authChallenges.delete(user.id);

    // Issue JWT similarly to existing login flow
    const accessToken = this.jwt.sign({
      sub: user.id,
      stellarAddress: user.stellarAddress,
      role: user.role,
    });

    return { accessToken, user };
  }
}
