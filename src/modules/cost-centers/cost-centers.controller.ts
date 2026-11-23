import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompanyRole, UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompanyRoles } from '../../common/decorators/company-roles.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CostCentersService } from './cost-centers.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

@ApiTags('cost-centers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
@Roles(UserRole.COMPANY)
@CompanyRoles(CompanyRole.OWNER)
@Controller('companies/me/cost-centers')
export class CostCentersController {
  constructor(private readonly costCentersService: CostCentersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a company cost center (OWNER only)' })
  create(@CurrentUser('id') companyId: string, @Body() dto: CreateCostCenterDto) {
    return this.costCentersService.create(companyId, dto);
  }

  @Get()
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING, CompanyRole.MEMBER)
  @ApiOperation({ summary: 'List company cost centers with spend totals' })
  findAll(@CurrentUser('id') companyId: string) {
    return this.costCentersService.findAll(companyId);
  }

  @Get(':id')
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING, CompanyRole.MEMBER)
  @ApiOperation({ summary: 'Get a single cost center with spend totals' })
  findOne(@CurrentUser('id') companyId: string, @Param('id') id: string) {
    return this.costCentersService.findOne(companyId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a cost center (OWNER only)' })
  update(
    @CurrentUser('id') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCostCenterDto,
  ) {
    return this.costCentersService.update(companyId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a cost center (OWNER only)' })
  remove(@CurrentUser('id') companyId: string, @Param('id') id: string) {
    return this.costCentersService.remove(companyId, id);
  }
}
