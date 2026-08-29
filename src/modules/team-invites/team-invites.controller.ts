import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TeamInvitesService } from './team-invites.service';
import { SendInviteDto } from './dto/send-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@ApiTags('team-invites')
@Controller('team-invites')
export class TeamInvitesController {
  constructor(
    private readonly teamInvitesService: TeamInvitesService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  /**
   * POST /team-invites — Send an invite to a teammate (COMPANY only).
   */
  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a team invite email to a colleague (COMPANY role only)' })
  @ApiResponse({ status: 201, description: 'Invite created and email sent' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — only COMPANY users may invite' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async sendInvite(@Request() req: any, @Body() dto: SendInviteDto) {
    const isEnabled = await this.featureFlagsService.isEnabled('team_invites');
    if (!isEnabled) {
      throw new BadRequestException('Team invites feature is currently disabled');
    }
    return this.teamInvitesService.sendInvite(req.user.id, dto);
  }

  /**
   * GET /team-invites — List pending invites sent by the authenticated company.
   */
  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY)
  @ApiOperation({ summary: 'List pending team invites sent by the authenticated company' })
  @ApiResponse({ status: 200, description: 'Pending invites returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listInvites(@Request() req: any) {
    return this.teamInvitesService.listInvites(req.user.id);
  }

  /**
   * POST /team-invites/accept — Accept an invite using the signed token.
   * This is an unauthenticated endpoint — the invitee does not have an account yet.
   */
  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Accept a team invite and create a new linked account' })
  @ApiQuery({ name: 'token', description: 'Signed invite token from the acceptance link' })
  @ApiResponse({ status: 201, description: 'Account created successfully' })
  @ApiResponse({ status: 400, description: 'Invite expired or already accepted' })
  @ApiResponse({ status: 404, description: 'Invite not found' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  acceptInvite(@Query('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.teamInvitesService.acceptInvite(token, dto);
  }

  /**
   * DELETE /team-invites/:id — Revoke a pending invite (COMPANY only).
   */
  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a pending team invite' })
  @ApiParam({ name: 'id', description: 'TeamInvite id' })
  @ApiResponse({ status: 200, description: 'Invite revoked' })
  @ApiResponse({ status: 400, description: 'Invite already accepted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Invite not found' })
  revokeInvite(@Request() req: any, @Param('id') id: string) {
    return this.teamInvitesService.revokeInvite(req.user.id, id);
  }
}
