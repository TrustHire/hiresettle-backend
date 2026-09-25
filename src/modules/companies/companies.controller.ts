import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CompanyRole, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompanyRoles } from '../../common/decorators/company-roles.decorator';
import { CompaniesService } from './companies.service';
import { InitiateTransferDto } from './dto/initiate-transfer.dto';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // ── Issue #360 ────────────────────────────────────────────────────────────

  @Post('transfer-ownership')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
  @Roles(UserRole.COMPANY)
  @CompanyRoles(CompanyRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate a company ownership transfer to an existing member (#360)',
    description:
      'Only the current OWNER can call this. The nominated member receives a pending ' +
      'transfer that expires in 7 days. They must accept via POST /companies/transfer-ownership/accept.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transfer initiated — awaiting acceptance by the new owner',
    schema: {
      properties: {
        transferId: { type: 'string' },
        newOwnerId: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'New owner is not a member or same as current owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not the company OWNER' })
  initiateTransfer(@Request() req: any, @Body() dto: InitiateTransferDto) {
    return this.companiesService.initiateTransfer(req.user.id, dto.newOwnerId);
  }

  @Post('transfer-ownership/accept')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a pending company ownership transfer (#360)',
    description:
      'The nominated member accepts the transfer. Old owner becomes a MEMBER. ' +
      'Action is recorded in the audit log.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transfer accepted — caller is now the company OWNER',
    schema: {
      properties: {
        message: { type: 'string' },
        companyId: { type: 'string' },
        previousOwnerId: { type: 'string' },
        newOwnerId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Transfer expired' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No pending transfer found for caller' })
  acceptTransfer(@Request() req: any) {
    return this.companiesService.acceptTransfer(req.user.id);
  }

  @Delete('transfer-ownership')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
  @Roles(UserRole.COMPANY)
  @CompanyRoles(CompanyRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending ownership transfer (#360)',
    description: 'Only the owner who initiated the transfer can cancel it.',
  })
  @ApiResponse({ status: 200, description: 'Transfer cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not the company OWNER' })
  @ApiResponse({ status: 404, description: 'No pending transfer to cancel' })
  cancelTransfer(@Request() req: any) {
    return this.companiesService.cancelTransfer(req.user.id);
  }

  @Get('transfer-ownership')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
  @Roles(UserRole.COMPANY)
  @CompanyRoles(CompanyRole.OWNER)
  @ApiOperation({
    summary: 'Get pending ownership transfer for the caller\'s company (#360)',
  })
  @ApiResponse({ status: 200, description: 'Transfer status returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not the company OWNER' })
  getPendingTransfer(@Request() req: any) {
    return this.companiesService.getPendingTransfer(req.user.id);
  }
}
