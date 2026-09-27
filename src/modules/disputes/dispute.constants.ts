import { DisputeStatus } from '@prisma/client';

/**
 * Disputes waiting on an arbiter or admin. These count toward an arbiter's
 * workload (#383) and are the only ones whose SLA clock runs (#381).
 */
export const ACTIVE_DISPUTE_STATUSES: DisputeStatus[] = [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW];
