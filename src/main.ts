import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { Integrations } from '@sentry/tracing';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { TooManyRequestsHeadersFilter } from './common/filters/too-many-requests-headers.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3001');
  const sentryDsn = config.get<string>('SENTRY_DSN');
  const nodeEnv = config.get<string>('NODE_ENV');

  if (sentryDsn && !['test', 'ci'].includes(nodeEnv)) {
    Sentry.init({
      dsn: sentryDsn,
      integrations: [
        new Integrations.Http({ tracing: true }),
        new Integrations.Express(),
      ],
      tracesSampleRate: 1.0,
    });
    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.errorHandler());
  }

  app.use(helmet());

  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix(apiPrefix);

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor());

  // Ensure TooManyRequests always has required headers.
  // Keep HttpExceptionFilter as the primary formatter.
  app.useGlobalFilters(new TooManyRequestsHeadersFilter());
  app.useGlobalFilters(new HttpExceptionFilter());





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
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port);
  logger.log(`HireSettle API running on http://localhost:${port}/${apiPrefix}`);
  logger.log(`Swagger docs at http://localhost:${port}/docs`);
}

bootstrap();
