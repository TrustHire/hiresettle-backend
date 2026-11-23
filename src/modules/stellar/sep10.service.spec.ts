import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Sep10Service } from './sep10.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Sep10Service', () => {
  let service: Sep10Service;
  let prisma: {
    sep10Challenge: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let config: { get: jest.Mock };

  const serverKeypair = Keypair.random();
  const clientKeypair = Keypair.random();

  beforeEach(async () => {
    prisma = {
      sep10Challenge: {
        create: jest.fn().mockResolvedValue({ id: 'ch-1' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'ch-1' }),
      },
    };
    config = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const map: Record<string, string | undefined> = {
          STELLAR_SECRET_KEY: serverKeypair.secret(),
          STELLAR_NETWORK: 'testnet',
          APP_DOMAIN: 'hiresettle.com',
        };
        return map[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Sep10Service,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<Sep10Service>(Sep10Service);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws on construction when STELLAR_SECRET_KEY is missing', () => {
    const badConfig = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;

    expect(() => new Sep10Service(prisma as any, badConfig)).toThrow(
      'STELLAR_SECRET_KEY is required for SEP-10',
    );
  });

  describe('createChallenge', () => {
    it('throws BadRequestException for an invalid Stellar account ID', async () => {
      await expect(service.createChallenge('not-a-g-address')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('issues a server-signed SEP-10 challenge and persists it', async () => {
      const res = await service.createChallenge(clientKeypair.publicKey());

      expect(res.network_passphrase).toBe(Networks.TESTNET);
      expect(typeof res.transaction).toBe('string');
      expect(prisma.sep10Challenge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          account: clientKeypair.publicKey(),
          xdr: res.transaction,
        }),
      });
    });
  });

  describe('verifyChallenge', () => {
    async function issueChallenge() {
      const issued = await service.createChallenge(clientKeypair.publicKey());
      const createArg = prisma.sep10Challenge.create.mock.calls[0][0].data;
      return {
        xdr: issued.transaction,
        nonce: createArg.nonce as string,
        expiresAt: createArg.expiresAt as Date,
      };
    }

    it('throws BadRequestException for invalid XDR', async () => {
      await expect(service.verifyChallenge('invalid-xdr')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when manageData operation is missing', async () => {
      const tx = new TransactionBuilder(new Account(serverKeypair.publicKey(), '-1'), {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
        timebounds: { minTime: 0, maxTime: 0 },
      })
        .addOperation(
          require('@stellar/stellar-sdk').Operation.bumpSequence({ bumpTo: '1' }),
        )
        .build();

      await expect(service.verifyChallenge(tx.toXDR())).rejects.toThrow(
        'Challenge transaction is missing manageData operation',
      );
    });

    it('throws UnauthorizedException when challenge is not found', async () => {
      const { xdr } = await issueChallenge();
      prisma.sep10Challenge.findUnique.mockResolvedValue(null);

      await expect(service.verifyChallenge(xdr)).rejects.toThrow('Challenge not found');
    });

    it('throws UnauthorizedException when challenge is already used', async () => {
      const { xdr, nonce, expiresAt } = await issueChallenge();
      prisma.sep10Challenge.findUnique.mockResolvedValue({
        account: clientKeypair.publicKey(),
        nonce,
        expiresAt,
        usedAt: new Date(),
      });

      await expect(service.verifyChallenge(xdr)).rejects.toThrow('Challenge already used');
    });

    it('throws UnauthorizedException when challenge is expired', async () => {
      const { xdr, nonce } = await issueChallenge();
      prisma.sep10Challenge.findUnique.mockResolvedValue({
        account: clientKeypair.publicKey(),
        nonce,
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      });

      await expect(service.verifyChallenge(xdr)).rejects.toThrow('Challenge expired');
    });

    it('throws UnauthorizedException when client signature is missing', async () => {
      const { xdr, nonce, expiresAt } = await issueChallenge();
      prisma.sep10Challenge.findUnique.mockResolvedValue({
        account: clientKeypair.publicKey(),
        nonce,
        expiresAt,
        usedAt: null,
      });

      await expect(service.verifyChallenge(xdr)).rejects.toThrow(
        'Client signature invalid or missing',
      );
    });

    it('verifies client-signed challenge, marks it used, and returns account', async () => {
      const { xdr, nonce, expiresAt } = await issueChallenge();
      const tx = new Transaction(xdr, Networks.TESTNET);
      tx.sign(clientKeypair);

      prisma.sep10Challenge.findUnique.mockResolvedValue({
        account: clientKeypair.publicKey(),
        nonce,
        expiresAt,
        usedAt: null,
      });

      const account = await service.verifyChallenge(tx.toXDR());

      expect(account).toBe(clientKeypair.publicKey());
      expect(prisma.sep10Challenge.update).toHaveBeenCalledWith({
        where: { nonce },
        data: { usedAt: expect.any(Date) },
      });
    });
  });
});
