/**
 * API tests — dispute detail, appeal and decision endpoints (#381, #382)
 *
 * Boots DisputesController over HTTP with the real validation pipe and
 * RolesGuard; services are mocked so routing, auth and payload validation
 * are exercised without a database.
 */
import * as request from 'supertest';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DisputeStage } from '@prisma/client';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { AppealService } from './appeal.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('DisputesController (API)', () => {
  let app: INestApplication;

  const prisma = { dispute: { findUnique: jest.fn() } };
  const disputes = { findOneForUser: jest.fn(), decide: jest.fn() };
  const appeals = { openAppeal: jest.fn(), decideAppeal: jest.fn() };

  const as = (user: object) => ({ 'x-test-user': JSON.stringify(user) });
  const company = { id: 'company-1', role: 'COMPANY' };
  const arbiter = { id: 'arb-1', role: 'ARBITER' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DisputesController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: DisputesService, useValue: disputes },
        { provide: AppealService, useValue: appeals },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          const header = req.headers['x-test-user'];
          if (!header) return false;
          req.user = JSON.parse(header);
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('GET /disputes/:id', () => {
    it('exposes the SLA deadline and appeal window', async () => {
      const body = {
        id: 'dispute-1',
        sla: { stage: 'ARBITER_REVIEW', responseDeadline: '2026-09-30T12:00:00.000Z', slaStatus: 'ON_TRACK', isOverdue: false },
        appealWindow: { deadline: null, isOpen: false },
      };
      disputes.findOneForUser.mockResolvedValue(body);

      const res = await request(app.getHttpServer()).get('/disputes/dispute-1').set(as(company)).expect(200);

      expect(res.body).toEqual(body);
      expect(disputes.findOneForUser).toHaveBeenCalledWith('dispute-1', company);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/disputes/dispute-1').expect(403);
    });
  });

  describe('POST /disputes/:id/appeal', () => {
    it('opens an appeal for the caller', async () => {
      appeals.openAppeal.mockResolvedValue({ id: 'appeal-1', disputeId: 'dispute-1' });

      await request(app.getHttpServer())
        .post('/disputes/dispute-1/appeal')
        .set(as(company))
        .send({ reason: 'Evidence was ignored' })
        .expect(201, { id: 'appeal-1', disputeId: 'dispute-1' });

      expect(appeals.openAppeal).toHaveBeenCalledWith('dispute-1', company, 'Evidence was ignored');
    });

    it('rejects an appeal without a reason', async () => {
      await request(app.getHttpServer()).post('/disputes/dispute-1/appeal').set(as(company)).send({}).expect(400);
      expect(appeals.openAppeal).not.toHaveBeenCalled();
    });
  });

  describe('POST /disputes/:id/decision', () => {
    it('routes first-tier decisions to the dispute service', async () => {
      const dispute = { id: 'dispute-1', stage: DisputeStage.ARBITER_REVIEW };
      prisma.dispute.findUnique.mockResolvedValue(dispute);
      disputes.decide.mockResolvedValue({ id: 'dispute-1', status: 'RESOLVED' });

      await request(app.getHttpServer())
        .post('/disputes/dispute-1/decision')
        .set(as(arbiter))
        .send({ outcome: 'RELEASE' })
        .expect(201);

      expect(disputes.decide).toHaveBeenCalledWith(dispute, 'RELEASE', arbiter);
      expect(appeals.decideAppeal).not.toHaveBeenCalled();
    });

    it('routes decisions on appealed disputes to the appeal service', async () => {
      prisma.dispute.findUnique.mockResolvedValue({ id: 'dispute-1', stage: DisputeStage.APPEAL_REVIEW });
      appeals.decideAppeal.mockResolvedValue({ id: 'dispute-1', isFinal: true });

      await request(app.getHttpServer())
        .post('/disputes/dispute-1/decision')
        .set(as(arbiter))
        .send({ outcome: 'REFUND' })
        .expect(201, { id: 'dispute-1', isFinal: true });

      expect(appeals.decideAppeal).toHaveBeenCalledWith('dispute-1', arbiter, 'REFUND');
      expect(disputes.decide).not.toHaveBeenCalled();
    });

    it('is restricted to arbiters and admins', async () => {
      await request(app.getHttpServer())
        .post('/disputes/dispute-1/decision')
        .set(as(company))
        .send({ outcome: 'RELEASE' })
        .expect(403);
    });

    it('rejects unknown outcomes', async () => {
      await request(app.getHttpServer())
        .post('/disputes/dispute-1/decision')
        .set(as(arbiter))
        .send({ outcome: 'SPLIT' })
        .expect(400);
    });

    it('404s for unknown disputes', async () => {
      prisma.dispute.findUnique.mockResolvedValue(null);
      await request(app.getHttpServer())
        .post('/disputes/missing/decision')
        .set(as(arbiter))
        .send({ outcome: 'RELEASE' })
        .expect(404);
    });
  });
});
