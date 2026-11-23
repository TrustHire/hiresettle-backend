import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { TeamInvitesService } from './team-invites.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PasswordPolicyService } from '../../common/password/password-policy.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
  }),
}));

describe('TeamInvitesService', () => {
  let service: TeamInvitesService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    teamInvite: {
      deleteMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let config: { get: jest.Mock };
  let passwordPolicy: { validate: jest.Mock };
  let sendMailMock: jest.Mock;

  beforeEach(async () => {
    sendMailMock = jest.fn().mockResolvedValue({ messageId: 'msg-1' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: sendMailMock });

    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      teamInvite: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    config = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const map: Record<string, unknown> = {
          JWT_SECRET: 'test-jwt-secret',
          FRONTEND_URL: 'http://localhost:3001',
          EMAIL_FROM: 'noreply@hiresettle.com',
          SMTP_HOST: 'localhost',
          SMTP_PORT: 587,
        };
        return map[key] ?? defaultValue;
      }),
    };

    passwordPolicy = { validate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamInvitesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: PasswordPolicyService, useValue: passwordPolicy },
      ],
    }).compile();

    service = module.get<TeamInvitesService>(TeamInvitesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendInvite', () => {
    it('throws ForbiddenException when caller is not a COMPANY user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: UserRole.RECRUITER });

      await expect(service.sendInvite('u-1', { email: 'teammate@co.com' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws ConflictException when email is already registered', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'owner-1', role: UserRole.COMPANY, company: 'Acme' })
        .mockResolvedValueOnce({ id: 'existing-1', email: 'teammate@co.com' });

      await expect(
        service.sendInvite('owner-1', { email: 'Teammate@Co.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates invite, revokes prior pending invite, and sends email', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'owner-1', role: UserRole.COMPANY, company: 'Acme' })
        .mockResolvedValueOnce(null);
      prisma.teamInvite.create.mockResolvedValue({
        id: 'inv-1',
        email: 'teammate@co.com',
        expiresAt,
      });

      const res = await service.sendInvite('owner-1', { email: 'Teammate@Co.com' });

      expect(prisma.teamInvite.deleteMany).toHaveBeenCalledWith({
        where: { companyOwnerId: 'owner-1', email: 'teammate@co.com', acceptedAt: null },
      });
      expect(prisma.teamInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyOwnerId: 'owner-1',
          email: 'teammate@co.com',
          token: expect.stringContaining('.'),
        }),
      });
      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ id: 'inv-1', email: 'teammate@co.com', expiresAt });
    });

    it('still succeeds if sending email throws', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'owner-1', role: UserRole.COMPANY, company: 'Acme' })
        .mockResolvedValueOnce(null);
      prisma.teamInvite.create.mockResolvedValue({
        id: 'inv-1',
        email: 'teammate@co.com',
        expiresAt: new Date(),
      });
      sendMailMock.mockRejectedValue(new Error('SMTP down'));

      const res = await service.sendInvite('owner-1', { email: 'teammate@co.com' });

      expect(res.id).toBe('inv-1');
    });
  });

  describe('acceptInvite', () => {
    const dto = { name: 'Alice', password: 'StrongPassword1!' };

    it('throws NotFoundException when token does not exist', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue(null);

      await expect(service.acceptInvite('bad-token', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when invite is already accepted', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 10_000),
      });

      await expect(service.acceptInvite('tok', dto)).rejects.toThrow(
        'This invite has already been accepted',
      );
    });

    it('throws BadRequestException when invite is expired', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        acceptedAt: null,
        expiresAt: new Date(Date.now() - 10_000),
      });

      await expect(service.acceptInvite('tok', dto)).rejects.toThrow('This invite has expired');
    });

    it('throws ConflictException when email was registered before acceptance', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        email: 'alice@co.com',
        companyOwnerId: 'owner-1',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u-existing' });

      await expect(service.acceptInvite('tok', dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates linked COMPANY user, marks invite accepted, and returns summary', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        email: 'alice@co.com',
        companyOwnerId: 'owner-1',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'owner-1', company: 'Acme Corp' });
      prisma.user.create.mockResolvedValue({
        id: 'u-new',
        email: 'alice@co.com',
        companyOwnerId: 'owner-1',
      });

      const res = await service.acceptInvite('tok', dto);

      expect(passwordPolicy.validate).toHaveBeenCalledWith(dto.password);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'alice@co.com',
          name: 'Alice',
          company: 'Acme Corp',
          role: UserRole.COMPANY,
          companyOwnerId: 'owner-1',
          passwordHash: expect.stringMatching(/^scrypt:/),
        }),
      });
      expect(prisma.teamInvite.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { acceptedAt: expect.any(Date) },
      });
      expect(res).toEqual({
        message: 'Invite accepted. Your account has been created.',
        userId: 'u-new',
        email: 'alice@co.com',
        companyOwnerId: 'owner-1',
      });
    });

    it('maps Prisma P2002 unique violation to ConflictException', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        email: 'alice@co.com',
        companyOwnerId: 'owner-1',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );

      await expect(service.acceptInvite('tok', dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listInvites', () => {
    it('returns non-accepted, non-expired invites for the company owner', async () => {
      prisma.teamInvite.findMany.mockResolvedValue([{ id: 'inv-1', email: 'a@b.com' }]);

      const res = await service.listInvites('owner-1');

      expect(prisma.teamInvite.findMany).toHaveBeenCalledWith({
        where: {
          companyOwnerId: 'owner-1',
          acceptedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        select: { id: true, email: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(res).toEqual([{ id: 'inv-1', email: 'a@b.com' }]);
    });
  });

  describe('revokeInvite', () => {
    it('throws NotFoundException when invite does not exist or belongs to another owner', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        companyOwnerId: 'other-owner',
      });

      await expect(service.revokeInvite('owner-1', 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when invite has already been accepted', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        companyOwnerId: 'owner-1',
        acceptedAt: new Date(),
      });

      await expect(service.revokeInvite('owner-1', 'inv-1')).rejects.toThrow(
        'Cannot revoke an already-accepted invite',
      );
    });

    it('deletes pending invite and returns { revoked: true }', async () => {
      prisma.teamInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        companyOwnerId: 'owner-1',
        acceptedAt: null,
      });

      const res = await service.revokeInvite('owner-1', 'inv-1');

      expect(prisma.teamInvite.delete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
      expect(res).toEqual({ revoked: true });
    });
  });
});
