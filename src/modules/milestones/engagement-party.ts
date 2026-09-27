import { ForbiddenException } from '@nestjs/common';

export type EngagementPartyRole = 'COMPANY' | 'RECRUITER' | 'ARBITER';

export interface EngagementPartyFields {
  companyId?: string | null;
  recruiterId?: string | null;
  arbiterId?: string | null;
  companyAddress: string;
  recruiterAddress: string;
  arbiterAddress: string;
}

export interface PartyUser {
  id?: string;
  stellarAddress?: string | null;
  role?: string;
}

/**
 * Which side of the engagement a user is on, matched by user id or wallet
 * address. Returns null for non-participants (admins included).
 */
export function engagementPartyRole(engagement: EngagementPartyFields, user: PartyUser): EngagementPartyRole | null {
  const matches = (id?: string | null, address?: string) =>
    (!!user.id && !!id && user.id === id) || (!!user.stellarAddress && user.stellarAddress === address);

  if (matches(engagement.companyId, engagement.companyAddress)) return 'COMPANY';
  if (matches(engagement.recruiterId, engagement.recruiterAddress)) return 'RECRUITER';
  if (matches(engagement.arbiterId, engagement.arbiterAddress)) return 'ARBITER';
  return null;
}

export function requirePartyRole(
  engagement: EngagementPartyFields,
  user: PartyUser,
  allowed: EngagementPartyRole[],
  message = 'Not permitted for your role on this engagement',
): EngagementPartyRole {
  const role = engagementPartyRole(engagement, user);
  if (!role || !allowed.includes(role)) throw new ForbiddenException(message);
  return role;
}
