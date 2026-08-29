import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { COMPANY_ROLES_KEY } from '../decorators/company-roles.decorator';

/**
 * Guards company write endpoints by checking the user's CompanyRole.
 * Users with no CompanyMember entry (original single-user companies) are treated as OWNER.
 * Must be applied after JwtAuthGuard/JwtOrApiKeyGuard so request.user is populated.
 */
@Injectable()
export class CompanyRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<CompanyRole[]>(COMPANY_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;
    // Only COMPANY role users participate in company-role checks
    if (user.role !== UserRole.COMPANY) {
      throw new ForbiddenException('Company role required');
    }

    // Look up the user's explicit company role membership
    const membership = await this.prisma.companyMember.findFirst({
      where: { memberId: user.id },
      select: { companyRole: true },
    });

    // No CompanyMember row → original single-user company → treat as OWNER
    const companyRole: CompanyRole = membership?.companyRole ?? CompanyRole.OWNER;

    if (!required.includes(companyRole)) {
      throw new ForbiddenException(
        `This action requires company role: ${required.join(' or ')}. Your role: ${companyRole}`,
      );
    }

    return true;
  }
}
