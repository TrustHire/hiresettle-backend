import { BadRequestException } from '@nestjs/common';
import { AdminReportsService } from './admin-reports.service';

describe('AdminReportsService revenue dashboard', () => {
  const prisma = { milestone: { findMany: jest.fn() } } as any;
  let service: AdminReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminReportsService(prisma);
    prisma.milestone.findMany.mockResolvedValue([
      { confirmedAt: new Date('2026-08-01T12:00:00Z'), paymentReleased: 100n },
      { confirmedAt: new Date('2026-08-03T12:00:00Z'), paymentReleased: 250n },
    ]);
  });

  it('returns daily buckets, including periods without payments', async () => {
    const result = await service.getRevenueDashboard(
      '2026-08-01',
      '2026-08-03',
      'daily',
    );

    expect(result.buckets).toEqual([
      { period: '2026-08-01', amount: '100' },
      { period: '2026-08-02', amount: '0' },
      { period: '2026-08-03', amount: '250' },
    ]);
    expect(result.total).toBe('350');
    expect(prisma.milestone.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'CONFIRMED' }),
    }));
  });

  it('returns monthly buckets with exact totals', async () => {
    const result = await service.getRevenueDashboard(
      '2026-07-15',
      '2026-09-02',
      'monthly',
    );

    expect(result.buckets).toEqual([
      { period: '2026-07', amount: '0' },
      { period: '2026-08', amount: '350' },
      { period: '2026-09', amount: '0' },
    ]);
  });

  it('rejects an invalid range or granularity', async () => {
    await expect(
      service.getRevenueDashboard('2026-08-03', '2026-08-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getRevenueDashboard('2026-08-01', '2026-08-03', 'weekly' as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});