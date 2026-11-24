import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashSecret, verifySecret } from '../../common/crypto/secret-box';
import { CreateOAuthClientDto, UpdateOAuthClientDto } from './dto/oauth-client.dto';

export const CLIENT_TOKEN_TYPE = 'client';
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

/** RFC 6749 §5.2 error, rendered by the token controller. */
export class OAuthError extends Error {
  constructor(public readonly error: string, public readonly status = 400, description?: string) {
    super(description ?? error);
  }
}

const PUBLIC_FIELDS = {
  id: true,
  clientId: true,
  name: true,
  scopes: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const newSecret = () => `hss_${randomBytes(32).toString('base64url')}`;

@Injectable()
export class OAuthClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------------- CRUD (company owners) ----------------

  async create(companyId: string, createdById: string, dto: CreateOAuthClientDto) {
    const clientSecret = newSecret();
    const client = await this.prisma.oAuthClient.create({
      data: {
        clientId: `hsc_${randomBytes(12).toString('hex')}`,
        secretHash: await hashSecret(clientSecret),
        name: dto.name.trim(),
        scopes: dto.scopes,
        companyId,
        createdById,
      },
      select: PUBLIC_FIELDS,
    });
    // The plaintext secret is only ever returned here and on rotation.
    return { ...client, clientSecret };
  }

  list(companyId: string) {
    return this.prisma.oAuthClient.findMany({
      where: { companyId },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const client = await this.prisma.oAuthClient.findFirst({ where: { id, companyId }, select: PUBLIC_FIELDS });
    if (!client) throw new NotFoundException(`OAuth client ${id} not found`);
    return client;
  }

  async update(companyId: string, id: string, dto: UpdateOAuthClientDto) {
    const existing = await this.get(companyId, id);
    if (existing.revokedAt) throw new ForbiddenException('Revoked clients cannot be modified');
    return this.prisma.oAuthClient.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.scopes !== undefined && { scopes: dto.scopes }),
      },
      select: PUBLIC_FIELDS,
    });
  }

  async rotateSecret(companyId: string, id: string) {
    const existing = await this.get(companyId, id);
    if (existing.revokedAt) throw new ForbiddenException('Revoked clients cannot be rotated');
    const clientSecret = newSecret();
    const client = await this.prisma.oAuthClient.update({
      where: { id },
      data: { secretHash: await hashSecret(clientSecret) },
      select: PUBLIC_FIELDS,
    });
    return { ...client, clientSecret };
  }

  /** Revocation is immediate: JwtStrategy re-checks the client on every request. */
  async revoke(companyId: string, id: string) {
    await this.get(companyId, id);
    return this.prisma.oAuthClient.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: PUBLIC_FIELDS,
    });
  }

  // ---------------- Token endpoint ----------------

  async issueToken(clientId: string | undefined, clientSecret: string | undefined, requestedScope?: string) {
    if (!clientId || !clientSecret) throw new OAuthError('invalid_client', 401, 'Client authentication failed');

    const client = await this.prisma.oAuthClient.findUnique({
      where: { clientId },
      include: {
        company: { select: { stellarAddress: true, role: true, deactivatedAt: true, deletedAt: true } },
      },
    });
    const valid = !!client && !client.revokedAt && (await verifySecret(clientSecret, client.secretHash));
    if (!client || !valid) throw new OAuthError('invalid_client', 401, 'Client authentication failed');
    if (client.company.deactivatedAt || client.company.deletedAt) {
      throw new OAuthError('unauthorized_client', 400, 'The owning company is deactivated');
    }

    // A token may narrow, never widen, the client's granted scopes.
    let scopes = client.scopes;
    if (requestedScope?.trim()) {
      const requested = [...new Set(requestedScope.trim().split(/\s+/))];
      const notGranted = requested.filter((s) => !client.scopes.includes(s));
      if (notGranted.length) {
        throw new OAuthError('invalid_scope', 400, `Scope not granted to this client: ${notGranted.join(' ')}`);
      }
      scopes = requested;
    }

    const expiresIn = Number(this.config.get('OAUTH_CLIENT_TOKEN_TTL_SECONDS', DEFAULT_TOKEN_TTL_SECONDS));
    const accessToken = await this.jwt.signAsync(
      {
        sub: client.companyId,
        cid: client.id,
        clientId: client.clientId,
        role: client.company.role,
        stellarAddress: client.company.stellarAddress,
        scope: scopes.join(' '),
        type: CLIENT_TOKEN_TYPE,
      },
      { expiresIn },
    );

    await this.prisma.oAuthClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });

    return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, scope: scopes.join(' ') };
  }
}
