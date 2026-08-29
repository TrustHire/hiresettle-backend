/**
 * Integration tests — Auth flow
 *
 * Requires: TEST_DATABASE_URL (or DATABASE_URL) pointing to a Postgres test DB
 * with all migrations already applied (prisma migrate deploy).
 *
 * Covers: register → login → refresh → logout
 */

import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { buildApp, teardownApp, cleanDatabase } from './setup';

describe('Auth integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let httpServer: any;

  beforeAll(async () => {
    ({ app, prisma } = await buildApp());
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await teardownApp();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  const baseUrl = '/api/v1';
  const userDto = {
    email: 'integration@example.com',
    password: 'P@ssw0rd!',
    name: 'Integration User',
  };

  // ── Register ──────────────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('registers a new user and returns token pair', async () => {
      const res = await request(httpServer)
        .post(`${baseUrl}/auth/register`)
        .send(userDto)
        .expect(201);

      expect(res.body.data).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: expect.objectContaining({ email: userDto.email }),
      });
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('returns 409 on duplicate email', async () => {
      await request(httpServer).post(`${baseUrl}/auth/register`).send(userDto);
      await request(httpServer)
        .post(`${baseUrl}/auth/register`)
        .send(userDto)
        .expect(409);
    });
  });

  // ── Login ─────────────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(httpServer).post(`${baseUrl}/auth/register`).send(userDto);
    });

    it('logs in with correct credentials', async () => {
      const res = await request(httpServer)
        .post(`${baseUrl}/auth/login`)
        .send({ email: userDto.email, password: userDto.password })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
    });

    it('returns 401 for wrong password', async () => {
      await request(httpServer)
        .post(`${baseUrl}/auth/login`)
        .send({ email: userDto.email, password: 'wrong' })
        .expect(401);
    });
  });

  // ── Refresh ───────────────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('issues a new token pair', async () => {
      const registerRes = await request(httpServer)
        .post(`${baseUrl}/auth/register`)
        .send(userDto);

      const { refreshToken } = registerRes.body.data;

      const res = await request(httpServer)
        .post(`${baseUrl}/auth/refresh`)
        .send({ refreshToken })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
    });

    it('returns 401 for already-consumed token (replay attack)', async () => {
      const registerRes = await request(httpServer)
        .post(`${baseUrl}/auth/register`)
        .send(userDto);

      const { refreshToken } = registerRes.body.data;

      // Consume the token
      await request(httpServer)
        .post(`${baseUrl}/auth/refresh`)
        .send({ refreshToken });

      // Attempt replay
      await request(httpServer)
        .post(`${baseUrl}/auth/refresh`)
        .send({ refreshToken })
        .expect(401);
    });
  });

  // ── Logout ────────────────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('revokes the refresh token', async () => {
      const registerRes = await request(httpServer)
        .post(`${baseUrl}/auth/register`)
        .send(userDto);

      const { refreshToken } = registerRes.body.data;

      const res = await request(httpServer)
        .post(`${baseUrl}/auth/logout`)
        .send({ refreshToken })
        .expect(201);

      expect(res.body.data.revoked).toBe(true);

      // Token should no longer work
      await request(httpServer)
        .post(`${baseUrl}/auth/refresh`)
        .send({ refreshToken })
        .expect(401);
    });
  });
});
