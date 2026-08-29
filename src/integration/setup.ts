import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppModule } from '../app.module';

let app: INestApplication;
let prisma: PrismaService;

export async function buildApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

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
  prisma = moduleRef.get<PrismaService>(PrismaService);
  return { app, prisma };
}

export async function teardownApp(): Promise<void> {
  if (prisma) await prisma.$disconnect();
  if (app) await app.close();
}

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  // Delete in dependency order
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "dispute_evidence" CASCADE');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "milestone_audit_logs" CASCADE',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "retention_schedules" CASCADE',
  );
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "notifications" CASCADE');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "notification_preferences" CASCADE',
  );
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "chain_events" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "milestones" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "engagements" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "refresh_tokens" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "system_config" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "dead_letter_events" CASCADE');
}
