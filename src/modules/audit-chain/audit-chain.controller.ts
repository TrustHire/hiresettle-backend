import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditChainService } from './audit-chain.service';
import { AUDIT_CHAIN_TABLES, AuditChainTable } from './audit-chain.util';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/audit-chain')
export class AuditChainController {
  constructor(private readonly auditChain: AuditChainService) {}

  @Get('verify')
  @ApiOperation({
    summary: 'Verify the audit log hash chains and report the first broken link (ADMIN only)',
    description: 'Walks every chain from genesis, recomputing each hash, and checks the latest daily anchor.',
  })
  @ApiQuery({ name: 'table', required: false, enum: Object.keys(AUDIT_CHAIN_TABLES) })
  verify(@Query('table') table?: string) {
    if (table && !(table in AUDIT_CHAIN_TABLES)) {
      throw new BadRequestException(`table must be one of: ${Object.keys(AUDIT_CHAIN_TABLES).join(', ')}`);
    }
    return this.auditChain.verify(table ? [table as AuditChainTable] : undefined);
  }

  @Get('last-report')
  @ApiOperation({ summary: 'Result of the most recent scheduled verification run (ADMIN only)' })
  lastReport() {
    return this.auditChain.getLastReport() ?? { message: 'No verification has run since the last restart' };
  }

  @Post('seal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seal pending audit entries into the chain now (ADMIN only)' })
  seal() {
    return this.auditChain.sealAll();
  }
}
