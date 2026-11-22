import { Controller, Get, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('companies')
@UseGuards(JwtAuthGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('me/audit-log')
  async getMyCompanyAuditLog(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
  ) {
    const companyId = req.user?.companyId;
    const role = req.user?.companyRole;

    if (!companyId) {
      throw new ForbiddenException('No company associated with this account');
    }

    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Only company owners or admins can access the audit log');
    }

    const parsedPage = page ? Math.max(1, parseInt(page, 10) || 1) : 1;
    const parsedLimit = limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20;

    return this.companiesService.getCompanyAuditLog(companyId, {
      page: parsedPage,
      limit: parsedLimit,
      actorId,
      action,
    });
  }
}
