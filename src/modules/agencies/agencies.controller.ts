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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AgenciesService } from './agencies.service';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { InviteAgencyMemberDto } from './dto/invite-agency-member.dto';

@ApiTags('agencies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RECRUITER)
@Controller('agencies')
export class AgenciesController {
  constructor(private readonly agenciesService: AgenciesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a recruiting agency (creator becomes OWNER)' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateAgencyDto) {
    return this.agenciesService.createAgency(userId, dto);
  }

  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an agency invite token' })
  @ApiQuery({ name: 'token', required: true })
  acceptInvite(@CurrentUser('id') userId: string, @Query('token') token: string) {
    return this.agenciesService.acceptInvite(userId, token);
  }

  @Post(':id/invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a recruiter to the agency (OWNER only)' })
  inviteMember(
    @CurrentUser('id') userId: string,
    @Param('id') agencyId: string,
    @Body() dto: InviteAgencyMemberDto,
  ) {
    return this.agenciesService.inviteMember(userId, agencyId, dto);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List agency members' })
  listMembers(@CurrentUser('id') userId: string, @Param('id') agencyId: string) {
    return this.agenciesService.listMembers(userId, agencyId);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member from the agency (OWNER only)' })
  removeMember(
    @CurrentUser('id') ownerId: string,
    @Param('id') agencyId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.agenciesService.removeMember(ownerId, agencyId, targetUserId);
  }

  @Get(':id/dashboard')
  @ApiOperation({ summary: 'Agency dashboard aggregating member engagements and payouts' })
  getDashboard(@CurrentUser('id') userId: string, @Param('id') agencyId: string) {
    return this.agenciesService.getDashboard(userId, agencyId);
  }

  @Get(':id/engagements')
  @ApiOperation({ summary: 'Read-only list of member engagements (OWNER only)' })
  getMemberEngagements(@CurrentUser('id') ownerId: string, @Param('id') agencyId: string) {
    return this.agenciesService.getMemberEngagements(ownerId, agencyId);
  }
}
