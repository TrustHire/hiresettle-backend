import './tracing';
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
import { TracingInterceptor } from './common/interceptors/tracing.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  const allowedOriginsStr = config.get<string>('ALLOWED_ORIGINS', 'http://localhost:3001');
  const allowedOrigins = allowedOriginsStr.split(',').map(origin => origin.trim());
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

  // Configure Helmet security headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable CSP for API context
      hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true,
      },
      frameguard: {
        action: 'deny', // X-Frame-Options: DENY
      },
    }),
  );

  // Configure CORS
  const corsOriginValidator = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like curl, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    const msg = 'The CORS policy for this site does not allow access from the specified origin.';
    return callback(new Error(msg), false);
  };

  app.enableCors({
    origin: corsOriginValidator,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health', method: 'GET' },
      { path: 'docs', method: 'GET' },
      { path: 'docs-json', method: 'GET' },
    ],
  });

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

  app.useGlobalInterceptors(new TracingInterceptor(), new TransformInterceptor());

  // Ensure TooManyRequests always has required headers.
  // Keep HttpExceptionFilter as the primary formatter.
  app.useGlobalFilters(new TooManyRequestsHeadersFilter());
  app.useGlobalFilters(new HttpExceptionFilter());

  if (nodeEnv !== 'production') {
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
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    // Add docs-json endpoint for Postman import
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.get('/docs-json', (req: any, res: any) => {
      res.json(document);
    });

    logger.log(`Swagger docs available at http://localhost:${port}/docs`);
    logger.log(`OpenAPI JSON available at http://localhost:${port}/docs-json`);
  }

  await app.listen(port);
  logger.log(`HireSettle API running on http://localhost:${port}/${apiPrefix}`);
}

bootstrap();
