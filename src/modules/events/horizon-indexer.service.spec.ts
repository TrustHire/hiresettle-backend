import { BadRequestException } from '@nestjs/common';
import { HorizonIndexerService } from './horizon-indexer.service';

describe('HorizonIndexerService backfill', () => {
  const prisma = {
    chainEvent: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  const stellar = { fetchContractEventsRange: jest.fn() } as any;
  const config = {} as any;
  let service: HorizonIndexerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HorizonIndexerService(prisma, stellar, config);
  });

  it('backfills new events and skips events already recorded', async () => {
    stellar.fetchContractEventsRange.mockResolvedValue([
      { ledger: 10, txHash: 'new-tx', topic: ['engagement_created'], value: ['engagement-1'] },
      { ledger: 11, txHash: 'existing-tx', topic: ['milestone_confirmed'], value: ['engagement-2'] },
    ]);
    prisma.chainEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'already-there', processed: true });

    await expect(service.backfillEvents(10, 11)).resolves.toBe(1);
    expect(stellar.fetchContractEventsRange).toHaveBeenCalledWith(10, 11);
    expect(prisma.chainEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.chainEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ledger: 10,
        txHash: 'new-tx',
        eventName: 'engagement_created',
        processed: false,
      }),
    });
  });

  it('rejects invalid or oversized ledger ranges', async () => {
    await expect(service.backfillEvents(20, 10)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.backfillEvents(1, 10002)).rejects.toBeInstanceOf(BadRequestException);
    expect(stellar.fetchContractEventsRange).not.toHaveBeenCalled();
  });
});