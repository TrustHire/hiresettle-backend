import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { AdminGuard } from '../guards/admin.guard';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { CreateAdminNoteDto } from './dto/create-admin-note.dto';

@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get(':id/notes')
  async listNotes(@Param('id') id: string) {
    return this.adminUsersService.listNotes(id);
  }

  @Post(':id/notes')
  async createNote(
    @Param('id') id: string,
    @Body() dto: CreateAdminNoteDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    return this.adminUsersService.createNote(id, admin.id, dto.body);
  }
}
