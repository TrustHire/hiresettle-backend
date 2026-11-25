import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompanyRole, UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompanyRoles } from '../../common/decorators/company-roles.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateOAuthClientDto, OAuthTokenRequestDto, UpdateOAuthClientDto } from './dto/oauth-client.dto';
import { OAuthClientsService, OAuthError } from './oauth-clients.service';

/** Only a signed-in human owner may manage clients — never a client token. */
function assertHumanOwner(user: any) {
  if (user?.authType === 'oauth_client') {
    throw new ForbiddenException('OAuth client tokens cannot manage OAuth clients');
  }
}

@ApiTags('oauth-clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
@Roles(UserRole.COMPANY)
@CompanyRoles(CompanyRole.OWNER)
@Controller('companies/me/oauth-clients')
export class OAuthClientsController {
  constructor(private readonly clients: OAuthClientsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an OAuth client (OWNER only). The secret is returned once.' })
  create(@CurrentUser() user: any, @Body() dto: CreateOAuthClientDto) {
    assertHumanOwner(user);
    return this.clients.create(user.id, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List OAuth clients' })
  list(@CurrentUser() user: any) {
    assertHumanOwner(user);
    return this.clients.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an OAuth client' })
  get(@CurrentUser() user: any, @Param('id') id: string) {
    assertHumanOwner(user);
    return this.clients.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a client or change its scopes (applies to newly issued tokens)' })
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateOAuthClientDto) {
    assertHumanOwner(user);
    return this.clients.update(user.id, id, dto);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new client secret; the old one stops working immediately' })
  rotate(@CurrentUser() user: any, @Param('id') id: string) {
    assertHumanOwner(user);
    return this.clients.rotateSecret(user.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a client; its outstanding tokens are rejected immediately' })
  revoke(@CurrentUser() user: any, @Param('id') id: string) {
    assertHumanOwner(user);
    return this.clients.revoke(user.id, id);
  }
}

@ApiTags('oauth')
@Controller('oauth')
export class OAuthTokenController {
  constructor(private readonly clients: OAuthClientsService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'OAuth 2.0 token endpoint (client_credentials grant)' })
  async token(
    @Body() body: OAuthTokenRequestDto,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    // RFC 6749 §2.3.1: HTTP Basic takes precedence over body credentials.
    let clientId = body.client_id;
    let clientSecret = body.client_secret;
    if (authorization?.startsWith('Basic ')) {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep > 0) {
        clientId = decodeURIComponent(decoded.slice(0, sep));
        clientSecret = decodeURIComponent(decoded.slice(sep + 1));
      }
    }

    try {
      return res.json(await this.clients.issueToken(clientId, clientSecret, body.scope));
    } catch (err) {
      if (err instanceof OAuthError) {
        if (err.status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="oauth"');
        return res.status(err.status).json({ error: err.error, error_description: err.message });
      }
      throw err;
    }
  }
}
