import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Controller('announcements')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateAnnouncementDto, @Req() req: any) {
    return this.announcementsService.create(dto, req.user);
  }

  @Get()
  findActive(@Req() req: any) {
    return this.announcementsService.findActiveForUser(req.user);
  }

  @Get('admin')
  @Roles('admin')
  findAll(@Query('role') role?: string) {
    return this.announcementsService.findAll(role);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.announcementsService.remove(id);
  }

  @Post(':id/dismiss')
  dismiss(@Param('id') id: string, @Req() req: any) {
    return this.announcementsService.dismiss(id, req.user);
  }
}
