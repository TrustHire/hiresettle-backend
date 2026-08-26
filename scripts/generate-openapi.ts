/**
 * scripts/generate-openapi.ts
 *
 * Boots the NestJS application in a headless mode (no HTTP listener) and
 * serialises the full OpenAPI document to docs/openapi.json.
 *
 * Usage (via npm script):
 *   npm run generate:openapi
 *
 * The output file is committed to the repository so the CI diff workflow
 * always has a baseline to compare against.
 */

// Must be set before any NestJS module is imported so ConfigService picks it
// up and the Swagger builder guard (NODE_ENV !== 'production') is satisfied.
process.env.NODE_ENV = 'ci';
// Provide dummy values for secrets that are validated at startup.
process.env.JWT_SECRET = 'generate-openapi-dummy-secret-32chars!!';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://dummy:dummy@localhost:5432/dummy';

import './src/tracing';
import * as path from 'path';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, {
    // Suppress application logs so the only stdout output is our own messages.
    logger: false,
  });

  const apiPrefix = process.env.API_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HireSettle API')
    .setDescription(
      'Backend API for HireSettle — milestone-based recruiter fee escrow on Stellar Soroban',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('engagements', 'Recruitment engagement lifecycle')
    .addTag('milestones', 'Milestone proof, unlock, and confirmation')
    .addTag('events', 'On-chain Stellar event feed')
    .addTag('notifications', 'User notifications')
    .addTag('auth', 'Email/password authentication')
    .addTag('health', 'Health check endpoints')
    .setBasePath(apiPrefix)
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Deterministic key order makes git diffs readable.
  const json = JSON.stringify(document, Object.keys(document).sort(), 2);

  const outDir = path.resolve(__dirname, 'docs');
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'openapi.json');
  fs.writeFileSync(outFile, json + '\n', 'utf8');

  console.log(`OpenAPI spec written to ${path.relative(process.cwd(), outFile)}`);

  await app.close();
}

main().catch((err) => {
  console.error('generate-openapi failed:', err);
  process.exit(1);
});
