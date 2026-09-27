// prisma/seed.ts
// HireSettle — database seed script with realistic demo data.
// Run: npx prisma db seed
//
// Refuses to run when NODE_ENV=production so demo data can never be
// written to a production database.

import {
  PrismaClient,
  EngagementStatus,
  MilestoneStatus,
  MilestoneKind,
  NotificationType,
  UserRole,
  CompanyRole,
  KycStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'Refusing to seed: NODE_ENV=production. The seed script creates demo data and must not run against production.',
    );
    process.exit(1);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const STROOP = 10_000_000n; // 1 XLM in stroops

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

async function main(): Promise<void> {
  assertNotProduction();

  console.log('Seeding demo data...');

  // ----------------------------------------------------------
  // Plans
  // ----------------------------------------------------------
  const starterPlan = await prisma.plan.upsert({
    where: { id: 'plan-starter' },
    update: {},
    create: { id: 'plan-starter', name: 'Starter', maxActiveEngagements: 5 },
  });

  const growthPlan = await prisma.plan.upsert({
    where: { id: 'plan-growth' },
    update: {},
    create: { id: 'plan-growth', name: 'Growth', maxActiveEngagements: 50 },
  });

  // ----------------------------------------------------------
  // Companies
  // ----------------------------------------------------------
  const acme = await prisma.user.upsert({
    where: { email: 'owner@acme-demo.test' },
    update: {},
    create: {
      email: 'owner@acme-demo.test',
      name: 'Alice Anderson',
      company: 'Acme Robotics',
      role: UserRole.COMPANY,
      planId: growthPlan.id,
      kycStatus: KycStatus.APPROVED,
      verifiedAt: daysFromNow(-30),
      stellarAddress: 'GACME0000000000000000000000000000000000000000000000000000',
    },
  });

  const globex = await prisma.user.upsert({
    where: { email: 'owner@globex-demo.test' },
    update: {},
    create: {
      email: 'owner@globex-demo.test',
      name: 'Grace Gomez',
      company: 'Globex Talent',
      role: UserRole.COMPANY,
      planId: starterPlan.id,
      kycStatus: KycStatus.PENDING,
      stellarAddress: 'GGLOBEX00000000000000000000000000000000000000000000000000',
    },
  });

  // Company members (owner + a billing teammate on Acme)
  await prisma.companyMember.upsert({
    where: { id: 'member-acme-owner' },
    update: {},
    create: {
      id: 'member-acme-owner',
      companyOwnerId: acme.id,
      userId: acme.id,
      role: CompanyRole.OWNER,
    },
  });

  const acmeBilling = await prisma.user.upsert({
    where: { email: 'billing@acme-demo.test' },
    update: {},
    create: {
      email: 'billing@acme-demo.test',
      name: 'Bob Billing',
      company: 'Acme Robotics',
      companyOwnerId: acme.id,
      role: UserRole.COMPANY,
      planId: growthPlan.id,
    },
  });

  await prisma.companyMember.upsert({
    where: { id: 'member-acme-billing' },
    update: {},
    create: {
      id: 'member-acme-billing',
      companyOwnerId: acme.id,
      userId: acmeBilling.id,
      role: CompanyRole.BILLING,
    },
  });

  // ----------------------------------------------------------
  // Recruiters
  // ----------------------------------------------------------
  const recruiterOne = await prisma.user.upsert({
    where: { email: 'recruiter.one@demo.test' },
    update: {},
    create: {
      email: 'recruiter.one@demo.test',
      name: 'Rita Recruiter',
      role: UserRole.RECRUITER,
      kycStatus: KycStatus.APPROVED,
      verifiedAt: daysFromNow(-20),
      stellarAddress: 'GRECRUIT100000000000000000000000000000000000000000000000000',
    },
  });

  const recruiterTwo = await prisma.user.upsert({
    where: { email: 'recruiter.two@demo.test' },
    update: {},
    create: {
      email: 'recruiter.two@demo.test',
      name: 'Ravi Recruiter',
      role: UserRole.RECRUITER,
      kycStatus: KycStatus.APPROVED,
      stellarAddress: 'GRECRUIT200000000000000000000000000000000000000000000000000',
    },
  });

  const arbiter = await prisma.user.upsert({
    where: { email: 'arbiter@demo.test' },
    update: {},
    create: {
      email: 'arbiter@demo.test',
      name: 'Ada Arbiter',
      role: UserRole.ARBITER,
      kycStatus: KycStatus.APPROVED,
      stellarAddress: 'GARBITER00000000000000000000000000000000000000000000000000',
    },
  });

  // ----------------------------------------------------------
  // Engagements — one per status
  // ----------------------------------------------------------
  const engagementSeeds: Array<{
    id: string;
    status: EngagementStatus;
    jobTitle: string;
    companyId: string;
    recruiterId: string;
    totalAmount: bigint;
    releasedAmount: bigint;
    createdAt: Date;
  }> = [
    {
      id: 'eng-pending-0001',
      status: EngagementStatus.PENDING_ACCEPTANCE,
      jobTitle: 'Senior Backend Engineer',
      companyId: acme.id,
      recruiterId: recruiterOne.id,
      totalAmount: 12000n * STROOP,
      releasedAmount: 0n,
      createdAt: daysFromNow(-2),
    },
    {
      id: 'eng-active-0002',
      status: EngagementStatus.ACTIVE,
      jobTitle: 'Staff Frontend Engineer',
      companyId: acme.id,
      recruiterId: recruiterTwo.id,
      totalAmount: 18000n * STROOP,
      releasedAmount: 6000n * STROOP,
      createdAt: daysFromNow(-25),
    },
    {
      id: 'eng-completed-0003',
      status: EngagementStatus.COMPLETED,
      jobTitle: 'DevOps Engineer',
      companyId: globex.id,
      recruiterId: recruiterOne.id,
      totalAmount: 15000n * STROOP,
      releasedAmount: 15000n * STROOP,
      createdAt: daysFromNow(-90),
    },
    {
      id: 'eng-cancelled-0004',
      status: EngagementStatus.CANCELLED,
      jobTitle: 'Data Scientist',
      companyId: globex.id,
      recruiterId: recruiterTwo.id,
      totalAmount: 20000n * STROOP,
      releasedAmount: 0n,
      createdAt: daysFromNow(-40),
    },
    {
      id: 'eng-replacement-0005',
      status: EngagementStatus.REPLACEMENT_REQUESTED,
      jobTitle: 'Product Designer',
      companyId: acme.id,
      recruiterId: recruiterOne.id,
      totalAmount: 14000n * STROOP,
      releasedAmount: 4000n * STROOP,
      createdAt: daysFromNow(-60),
    },
    {
      id: 'eng-merged-0006',
      status: EngagementStatus.ACCOUNT_MERGED,
      jobTitle: 'QA Engineer',
      companyId: globex.id,
      recruiterId: recruiterTwo.id,
      totalAmount: 9000n * STROOP,
      releasedAmount: 9000n * STROOP,
      createdAt: daysFromNow(-120),
    },
  ];

  for (const seed of engagementSeeds) {
    await prisma.engagement.upsert({
      where: { id: seed.id },
      update: { status: seed.status },
      create: {
        id: seed.id,
        companyAddress: acme.stellarAddress ?? 'GACME0000000000000000000000000000000000000000000000000000',
        recruiterAddress:
          recruiterOne.stellarAddress ?? 'GRECRUIT100000000000000000000000000000000000000000000000000',
        arbiterAddress:
          arbiter.stellarAddress ?? 'GARBITER00000000000000000000000000000000000000000000000000',
        companyId: seed.companyId,
        recruiterId: seed.recruiterId,
        arbiterId: arbiter.id,
        tokenAddress: 'CDEMOTOKEN000000000000000000000000000000000000000000000000',
        totalAmount: seed.totalAmount,
        releasedAmount: seed.releasedAmount,
        escrowBalance: seed.totalAmount - seed.releasedAmount,
        jobTitle: seed.jobTitle,
        jobDescription: `Demo engagement for ${seed.jobTitle}.`,
        status: seed.status,
        createdAt: seed.createdAt,
      },
    });
  }

  // ----------------------------------------------------------
  // Milestones — attached to the active engagement
  // ----------------------------------------------------------
  const milestoneSeeds: Array<{
    id: string;
    engagementId: string;
    title: string;
    amount: bigint;
    status: MilestoneStatus;
    kind: MilestoneKind;
    dueDate: Date;
  }> = [
    {
      id: 'ms-active-0001',
      engagementId: 'eng-active-0002',
      title: 'Placement fee',
      amount: 6000n * STROOP,
      status: MilestoneStatus.CONFIRMED,
      kind: MilestoneKind.PLACEMENT,
      dueDate: daysFromNow(-10),
    },
    {
      id: 'ms-active-0002',
      engagementId: 'eng-active-0002',
      title: '90-day retention',
      amount: 6000n * STROOP,
      status: MilestoneStatus.PROOF_SUBMITTED,
      kind: MilestoneKind.RETENTION,
      dueDate: daysFromNow(15),
    },
    {
      id: 'ms-active-0003',
      engagementId: 'eng-active-0002',
      title: '180-day retention',
      amount: 6000n * STROOP,
      status: MilestoneStatus.LOCKED,
      kind: MilestoneKind.RETENTION,
      dueDate: daysFromNow(105),
    },
    {
      id: 'ms-replacement-0001',
      engagementId: 'eng-replacement-0005',
      title: 'Placement fee',
      amount: 4000n * STROOP,
      status: MilestoneStatus.DISPUTED,
      kind: MilestoneKind.PLACEMENT,
      dueDate: daysFromNow(-5),
    },
  ];

  for (const seed of milestoneSeeds) {
    await prisma.milestone.upsert({
      where: { id: seed.id },
      update: { status: seed.status },
      create: {
        id: seed.id,
        engagementId: seed.engagementId,
        title: seed.title,
        amount: seed.amount,
        status: seed.status,
        kind: seed.kind,
        dueDate: seed.dueDate,
      },
    });
  }

  // ----------------------------------------------------------
  // Notifications
  // ----------------------------------------------------------
  const notificationSeeds: Array<{
    id: string;
    userId: string;
    engagementId: string;
    type: NotificationType;
    message: string;
    read: boolean;
  }> = [
    {
      id: 'notif-0001',
      userId: acme.id,
      engagementId: 'eng-active-0002',
      type: NotificationType.ENGAGEMENT_CREATED,
      message: 'Engagement "Staff Frontend Engineer" was created.',
      read: true,
    },
    {
      id: 'notif-0002',
      userId: acme.id,
      engagementId: 'eng-active-0002',
      type: NotificationType.PROOF_SUBMITTED,
      message: 'Proof submitted for milestone "90-day retention".',
      read: false,
    },
    {
      id: 'notif-0003',
      userId: recruiterTwo.id,
      engagementId: 'eng-active-0002',
      type: NotificationType.MILESTONE_CONFIRMED,
      message: 'Milestone "Placement fee" was confirmed.',
      read: true,
    },
    {
      id: 'notif-0004',
      userId: acme.id,
      engagementId: 'eng-replacement-0005',
      type: NotificationType.DISPUTE_RAISED,
      message: 'A dispute was raised on engagement "Product Designer".',
      read: false,
    },
    {
      id: 'notif-0005',
      userId: recruiterOne.id,
      engagementId: 'eng-replacement-0005',
      type: NotificationType.REPLACEMENT_REQUESTED,
      message: 'A replacement was requested for engagement "Product Designer".',
      read: false,
    },
    {
      id: 'notif-0006',
      userId: globex.id,
      engagementId: 'eng-completed-0003',
      type: NotificationType.PAYMENT_RELEASED,
      message: 'Payment released for engagement "DevOps Engineer".',
      read: true,
    },
  ];

  for (const seed of notificationSeeds) {
    await prisma.notification.upsert({
      where: { id: seed.id },
      update: { read: seed.read },
      create: {
        id: seed.id,
        userId: seed.userId,
        engagementId: seed.engagementId,
        type: seed.type,
        message: seed.message,
        read: seed.read,
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  Companies:     ${[acme, globex].length}`);
  console.log(`  Recruiters:    ${[recruiterOne, recruiterTwo].length}`);
  console.log(`  Engagements:   ${engagementSeeds.length}`);
  console.log(`  Milestones:    ${milestoneSeeds.length}`);
  console.log(`  Notifications: ${notificationSeeds.length}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
