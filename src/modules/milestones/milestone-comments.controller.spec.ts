/**
 * API tests — milestone comments (#379)
 *
 * Boots MilestoneCommentsController over HTTP with the real validation pipe;
 * the service is mocked so routing, auth and payload validation are
 * exercised without a database.
 */
import * as request from 'supertest';
import { ExecutionContext, ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MilestoneCommentsController } from './milestone-comments.controller';
import { MilestoneCommentsService } from './milestone-comments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';

describe('MilestoneCommentsController (API)', () => {
  let app: INestApplication;
  const comments = { create: jest.fn(), list: jest.fn() };
  const recruiter = { id: 'recruiter-1', role: 'RECRUITER', stellarAddress: 'GRECRUITER' };
  const base = '/engagements/ENG-001/milestones/0/comments';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MilestoneCommentsController],
      providers: [{ provide: MilestoneCommentsService, useValue: comments }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          if (!req.headers.authorization) return false;
          req.user = recruiter;
          return true;
        },
      })
      .overrideGuard(UserJwtSubThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates a comment for the caller', async () => {
    comments.create.mockResolvedValue({ id: 'c-1', body: 'Updated proof attached' });

    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', 'Bearer t')
      .send({ body: 'Updated proof attached' })
      .expect(201, { id: 'c-1', body: 'Updated proof attached' });

    expect(comments.create).toHaveBeenCalledWith('ENG-001', 0, recruiter, 'Updated proof attached');
  });

  it('rejects an empty comment', async () => {
    await request(app.getHttpServer()).post(base).set('Authorization', 'Bearer t').send({ body: '' }).expect(400);
    expect(comments.create).not.toHaveBeenCalled();
  });

  it('rejects unknown fields', async () => {
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', 'Bearer t')
      .send({ body: 'hi', authorId: 'someone-else' })
      .expect(400);
  });

  it('passes pagination parameters through', async () => {
    comments.list.mockResolvedValue({ data: [], nextCursor: null });

    await request(app.getHttpServer())
      .get(`${base}?limit=5&cursor=c-10`)
      .set('Authorization', 'Bearer t')
      .expect(200, { data: [], nextCursor: null });

    expect(comments.list).toHaveBeenCalledWith('ENG-001', 0, recruiter, expect.objectContaining({ limit: 5, cursor: 'c-10' }));
  });

  it('rejects a page size above 100', async () => {
    await request(app.getHttpServer()).get(`${base}?limit=101`).set('Authorization', 'Bearer t').expect(400);
  });

  it('surfaces participant-only authorization as 403', async () => {
    comments.list.mockRejectedValue(new ForbiddenException('Only engagement participants'));
    await request(app.getHttpServer()).get(base).set('Authorization', 'Bearer t').expect(403);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get(base).expect(403);
  });

  it('rejects a non-numeric milestone index', async () => {
    await request(app.getHttpServer())
      .get('/engagements/ENG-001/milestones/abc/comments')
      .set('Authorization', 'Bearer t')
      .expect(400);
  });
});
