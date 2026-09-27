/**
 * API tests — tokenized calendar feed (#380)
 *
 * Boots CalendarController over HTTP with a mocked Prisma layer, so the
 * token flow is exercised end-to-end without a database.
 */
import * as request from 'supertest';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('CalendarController (API)', () => {
  let app: INestApplication;
  let storedHash: string | null;

  const prisma = {
    user: {
      update: jest.fn(async ({ data }) => {
        storedHash = data.calendarTokenHash;
        return {};
      }),
      findUnique: jest.fn(async ({ where }) =>
        storedHash && where.calendarTokenHash === storedHash
          ? { id: 'user-1', stellarAddress: 'GABC', deactivatedAt: null, deletedAt: null }
          : null,
      ),
    },
    milestone: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ms-0',
          milestoneIndex: 0,
          name: 'Placement',
          kind: 'PLACEMENT',
          paymentPercent: 100,
          status: 'PENDING',
          placementDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          unlockEstimatedAt: null,
          engagement: { id: 'ENG-001', jobTitle: 'Senior Engineer' },
        },
      ]),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60, limit: 1000 }])],
      controllers: [CalendarController],
      providers: [CalendarService, { provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          if (!req.headers.authorization) return false;
          req.user = { id: 'user-1', role: 'COMPANY' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storedHash = null;
  });

  const regenerate = () =>
    request(app.getHttpServer())
      .post('/users/me/calendar-token/regenerate')
      .set('Authorization', 'Bearer test')
      .expect(200);

  it('requires a JWT to regenerate the token', async () => {
    await request(app.getHttpServer()).post('/users/me/calendar-token/regenerate').expect(403);
  });

  it('serves a text/calendar feed for a valid token', async () => {
    const { body } = await regenerate();

    const res = await request(app.getHttpServer()).get(`/users/me/calendar.ics?token=${body.token}`).expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    expect(res.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(res.text).toContain('UID:milestone-ms-0@hiresettle');
    expect(res.text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('returns 401 without a token', async () => {
    await request(app.getHttpServer()).get('/users/me/calendar.ics').expect(401);
  });

  it('returns 401 for an unknown token', async () => {
    await regenerate();
    await request(app.getHttpServer()).get('/users/me/calendar.ics?token=not-the-token').expect(401);
  });

  it('invalidates the old feed URL when the token is regenerated', async () => {
    const first = await regenerate();
    const second = await regenerate();

    await request(app.getHttpServer()).get(`/users/me/calendar.ics?token=${first.body.token}`).expect(401);
    await request(app.getHttpServer()).get(`/users/me/calendar.ics?token=${second.body.token}`).expect(200);
  });

  it('disables the feed once the token is revoked', async () => {
    const { body } = await regenerate();

    await request(app.getHttpServer())
      .delete('/users/me/calendar-token')
      .set('Authorization', 'Bearer test')
      .expect(200, { revoked: true });

    await request(app.getHttpServer()).get(`/users/me/calendar.ics?token=${body.token}`).expect(401);
  });
});
