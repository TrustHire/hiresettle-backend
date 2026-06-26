import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { Keypair } from '@stellar/stellar-sdk';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory nonce store — replace with Redis in production
  private readonly nonces = new Map<string, { nonce: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) { }

  generateNonce(stellarAddress: string): string {
    const nonce = `hiresettle:${stellarAddress}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.nonces.set(stellarAddress, {
      nonce,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
    return nonce;
  }

  async walletLogin(dto: LoginDto): Promise<{ accessToken: string; user: any }> {
    const { stellarAddress, signedNonce, signature } = dto;

    const stored = this.nonces.get(stellarAddress);
    if (!stored || Date.now() > stored.expiresAt) {
      throw new UnauthorizedException('Nonce expired or not found. Request a new one.');
    }

    if (signedNonce !== stored.nonce) {
      throw new UnauthorizedException('Signed nonce does not match the challenge.');
    }

    let sigBytes: Uint8Array;
    try {
      sigBytes = Uint8Array.from(Buffer.from(signature, 'base64'));
    } catch {
      throw new UnauthorizedException('Invalid signature encoding (expected base64).');
    }

    let keypair: Keypair;
    try {
      keypair = Keypair.fromPublicKey(stellarAddress);
    } catch {
      throw new UnauthorizedException('Invalid Stellar address.');
    }

    const msgBytes = Buffer.from(stored.nonce, 'utf8');
    const isValid = keypair.verify(msgBytes, sigBytes);
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

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

  async updateProfile(userId: string, dto: any) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl } : {}),
      },
    });
  // Backward-compatible method name
  login(dto: LoginDto): Promise<{ accessToken: string; user: any }> {
    return this.walletLogin(dto);
  }
}

