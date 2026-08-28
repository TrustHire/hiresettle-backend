import { SetMetadata } from '@nestjs/common';
import { CompanyRole } from '@prisma/client';

export const COMPANY_ROLES_KEY = 'companyRoles';
export const CompanyRoles = (...roles: CompanyRole[]) => SetMetadata(COMPANY_ROLES_KEY, roles);
