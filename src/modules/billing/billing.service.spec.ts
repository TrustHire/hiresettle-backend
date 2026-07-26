import { Test, TestingModule } from '@nestjs/testing';
import { EngagementStatus, UserRole } from '@prisma/client';
import { BillingService } from './billing.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPANY_ADDRESS = 'GCOMPANY123';
const OTHER_ADDRESS = 'GOTHER456';

const makeUser = (role: UserRole, stellarAddress = COMPANY_ADDRESS) =>
  ({
    id: 'user-1',
    role,
    stellarAddress,
    email: `${role.toLowerCase()}@test.com`,
    name: role === UserRole.ADMIN ? 'Admin User' : 'Company User',
  }) as any;

const makeEngagement = (overrides: Partial<{
  id: string;
  companyAddress: string;
  status: EngagementStatus;
  totalAmount: bigint;
  createdAt: Date;
}> = {}) => ({
  id: overrides.id ?? 'eng-1',
  companyAddress: overrides.companyAddress ?? COMPANY_ADDRESS,
  totalAmount: overrides.totalAmount ?? BigInt(1_000_000),
  releasedAmount: BigInt(0),
  status: overrides.status ?? EngagementStatus.ACTIVE,
  jobTitle: 'Senior Engineer',
  createdAt: overrides.createdAt ?? new Date('2026-07-01T10:00:00Z'),
  updatedAt: new Date('2026-07-01T10:00:00Z'),
});

const mockPrisma = {
  engagement: { findMany: jest.fn() },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the CSV string into header + data rows. */
function parseCsv(csv: string) {
  const lines = csv.split('\n').filter((l) => l.trim() !== '');
  const header = lines[0].split(',');
  const rows = lines.slice(1).map((l) => l.split(','));
  return { header, rows };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BillingService — exportBillingHistory()', () => {
  let service: BillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // CSV structure
  // -----------------------------------------------------------------------

  it('returns a CSV with the required header columns', async () => {
    mockPrisma.engagement.findMany.mockResolvedValue([]);

    const csv = await service.exportBillingHistory(makeUser(UserRole.COMPANY));

    const { header } = parseCsv(csv);
    expect(header).toEqual(['Date', 'Engagement Reference', 'Amount (stroops)', 'Status']);
  });

  it('produces one data row per engagement', async () => {
    const engagements = [makeEngagement({ id: 'eng-1' }), makeEngagement({ id: 'eng-2' })];
    mockPrisma.engagement.findMany.mockResolvedValue(engagements);

    const csv = await service.exportBillingHistory(makeUser(UserRole.COMPANY));

    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(2);
  });

  it('each row contains date, engagement reference, amount, and status', async () => {
    const eng = makeEngagement({
      id: 'eng-abc',
      totalAmount: BigInt(5_000_000),
      status: EngagementStatus.COMPLETED,
      createdAt: new Date('2026-07-15T12:00:00Z'),
    });
    mockPrisma.engagement.findMany.mockResolvedValue([eng]);

    const csv = await service.exportBillingHistory(makeUser(UserRole.COMPANY));

    const { rows } = parseCsv(csv);
    const [date, ref, amount, status] = rows[0];

    expect(date).toBe('2026-07-15T12:00:00.000Z');
    expect(ref).toBe('eng-abc');
    expect(amount).toBe('5000000');
    expect(status).toBe(EngagementStatus.COMPLETED);
  });

  it('returns only the header line when there are no matching records', async () => {
    mockPrisma.engagement.findMany.mockResolvedValue([]);

    const csv = await service.exportBillingHistory(makeUser(UserRole.COMPANY));

    const lines = csv.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1); // header only
  });

  // -----------------------------------------------------------------------
  // Role scoping
  // -----------------------------------------------------------------------

  it('scopes query to the company stellarAddress for COMPANY role', async () => {
    mockPrisma.engagement.findMany.mockResolvedValue([]);

    await service.exportBillingHistory(makeUser(UserRole.COMPANY, COMPANY_ADDRESS));

    const callArg = mockPrisma.engagement.findMany.mock.calls[0][0];
    expect(callArg.where).toMatchObject({ companyAddress: COMPANY_ADDRESS });
  });

  it('does NOT apply a companyAddress filter for ADMIN role', async () => {
    mockPrisma.engagement.findMany.mockResolvedValue([]);

    await service.exportBillingHistory(makeUser(UserRole.ADMIN));

    const callArg = mockPrisma.engagement.findMany.mock.calls[0][0];
    expect(callArg.where.companyAddress).toBeUndefined();
  });

  it('admin receives records from all companies', async () => {
    const engagements = [
      makeEngagement({ id: 'eng-1', companyAddress: COMPANY_ADDRESS }),
      makeEngagement({ id: 'eng-2', companyAddress: OTHER_ADDRESS }),
    ];
    mockPrisma.engagement.findMany.mockResolvedValue(engagements);

    const csv = await service.exportBillingHistory(makeUser(UserRole.ADMIN));

    const { rows } = parseCsv(csv);
    const refs = rows.map((r) => r[1]);
    expect(refs).toContain('eng-1');
    expect(refs).toContain('eng-2');
  });

  // -----------------------------------------------------------------------
  // Date filtering
  // -----------------------------------------------------------------------

  it('passes fromDate and toDate through to the query', async () => {
    mockPrisma.engagement.findMany.mockResolvedValue([]);

    const from = new Date('2026-01-01');
    const to = new Date('2026-06-30');
    await service.exportBillingHistory(makeUser(UserRole.COMPANY), from, to);

    const callArg = mockPrisma.engagement.findMany.mock.calls[0][0];
    expect(callArg.where.createdAt).toEqual({ gte: from, lte: to });
  });

  // -----------------------------------------------------------------------
  // CSV escaping
  // -----------------------------------------------------------------------

  it('wraps values containing commas in double quotes', async () => {
    // Inject an engagement whose ID contains a comma to test escaping
    const eng = makeEngagement({ id: 'eng,with,commas' });
    mockPrisma.engagement.findMany.mockResolvedValue([eng]);

    const csv = await service.exportBillingHistory(makeUser(UserRole.COMPANY));

    expect(csv).toContain('"eng,with,commas"');
  });
});
