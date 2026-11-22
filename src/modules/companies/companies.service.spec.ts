import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole } from '@prisma/client';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../../common/prisma/prisma.service';

type MockPrisma = {
  user: { findUnique: jest.Mock; update: jest.Mock };
  companyMember: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  ownershipTransfer: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

describe('CompaniesService', () => {
  let service: CompaniesService;
  let prisma: MockPrisma;

  const buildTx = () => ({
    ownershipTransfer: { update: jest.fn().mockResolvedValue({}) },
    companyMember: {
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      companyMember: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      ownershipTransfer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(buildTx())),
    };
    service = new CompaniesService(prisma as unknown as PrismaService);
  });

  // ── Proof SLA settings ────────────────────────────────────────────────────

  describe('getProofSlaSettings', () => {
    it('returns the SLA settings for an existing user', async () => {
      prisma.user.findUnique.mockResolvedValue({ proofSlaDays: 3, proofSlaAction: 'REMIND' });

      const result = await service.getProofSlaSettings('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { proofSlaDays: true, proofSlaAction: true },
      });
      expect(result).toEqual({ proofSlaDays: 3, proofSlaAction: 'REMIND' });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProofSlaSettings('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateProofSlaSettings', () => {
    it('updates only the provided fields', async () => {
      prisma.user.update.mockResolvedValue({ proofSlaDays: 5, proofSlaAction: 'REMIND' });

      const result = await service.updateProofSlaSettings('user-1', { proofSlaDays: 5 } as never);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { proofSlaDays: 5 },
        select: { proofSlaDays: true, proofSlaAction: true },
      });
      expect(result).toEqual({ proofSlaDays: 5, proofSlaAction: 'REMIND' });
    });

    it('sends an empty data object when no fields are provided', async () => {
      prisma.user.update.mockResolvedValue({ proofSlaDays: 1, proofSlaAction: 'REMIND' });

      await service.updateProofSlaSettings('user-1', {} as never);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {},
        select: { proofSlaDays: true, proofSlaAction: true },
      });
    });
  });

  // ── Ownership transfer ────────────────────────────────────────────────────

  describe('initiateTransfer', () => {
    it('rejects transferring ownership to yourself', async () => {
      await expect(service.initiateTransfer('owner-1', 'owner-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.companyMember.findUnique).not.toHaveBeenCalled();
    });

    it('rejects when the proposed new owner is not a member', async () => {
      prisma.companyMember.findUnique.mockResolvedValue(null);

      await expect(service.initiateTransfer('owner-1', 'stranger')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.ownershipTransfer.create).not.toHaveBeenCalled();
    });

    it('cancels any pending transfer and creates a new one', async () => {
      prisma.companyMember.findUnique.mockResolvedValue({ companyRole: CompanyRole.MEMBER });
      const expiresAt = new Date(Date.now() + 1000);
      prisma.ownershipTransfer.create.mockResolvedValue({ id: 'transfer-1', expiresAt });

      const result = await service.initiateTransfer('owner-1', 'member-1');

      expect(prisma.ownershipTransfer.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'owner-1', acceptedAt: null, cancelledAt: null },
        data: { cancelledAt: expect.any(Date) },
      });
      expect(prisma.ownershipTransfer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'owner-1',
          fromOwnerId: 'owner-1',
          toMemberId: 'member-1',
        }),
      });
      expect(result).toEqual({
        transferId: 'transfer-1',
        newOwnerId: 'member-1',
        expiresAt,
        message: expect.any(String),
      });
    });
  });

  describe('acceptTransfer', () => {
    it('throws NotFoundException when no pending transfer exists', async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue(null);

      await expect(service.acceptTransfer('member-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an expired transfer', async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue({
        id: 'transfer-1',
        companyId: 'owner-1',
        fromOwnerId: 'owner-1',
        toMemberId: 'member-1',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.acceptTransfer('member-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('completes the transfer inside a transaction', async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue({
        id: 'transfer-1',
        companyId: 'owner-1',
        fromOwnerId: 'owner-1',
        toMemberId: 'member-1',
        expiresAt: new Date(Date.now() + 1000),
      });

      const result = await service.acceptTransfer('member-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        message: expect.any(String),
        companyId: 'owner-1',
        previousOwnerId: 'owner-1',
        newOwnerId: 'member-1',
      });
    });
  });

  describe('cancelTransfer', () => {
    it('throws NotFoundException when there is nothing to cancel', async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue(null);

      await expect(service.cancelTransfer('owner-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cancels the pending transfer', async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue({ id: 'transfer-1' });

      const result = await service.cancelTransfer('owner-1');

      expect(prisma.ownershipTransfer.update).toHaveBeenCalledWith({
        where: { id: 'transfer-1' },
        data: { cancelledAt: expect.any(Date) },
      });
      expect(result).toEqual({ message: 'Ownership transfer cancelled.' });
    });
  });

  describe('getPendingTransfer', () => {
    it('returns pending:false when no transfer exists', async () => {
      prisma.ownershipTransfer.findFirst.mockResolvedValue(null);

      const result = await service.getPendingTransfer('owner-1');

      expect(result).toEqual({ pending: false });
    });

    it('returns the pending transfer details', async () => {
      const createdAt = new Date();
      const expiresAt = new Date(Date.now() + 1000);
      prisma.ownershipTransfer.findFirst.mockResolvedValue({
        id: 'transfer-1',
        fromOwnerId: 'owner-1',
        toMemberId: 'member-1',
        expiresAt,
        createdAt,
      });

      const result = await service.getPendingTransfer('owner-1');

      expect(result).toEqual({
        pending: true,
        transferId: 'transfer-1',
        fromOwnerId: 'owner-1',
        toMemberId: 'member-1',
        expiresAt,
        createdAt,
      });
    });
  });
});
