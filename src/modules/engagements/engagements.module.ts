import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { EngagementsController } from './engagements.controller';
import { EngagementsService } from './engagements.service';
import { SavedFiltersService } from './saved-filters.service';
import { EngagementNotesService } from './engagement-notes.service';
import { EngagementWatchersService } from './engagement-watchers.service';
import { EngagementImportService } from './engagement-import.service';
import { EngagementCandidateDetailsService } from './engagement-candidate-details.service';
import { EngagementAttachmentsService } from './engagement-attachments.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditLogService } from './audit-log.service';
import { ActivityFeedService } from './activity-feed.service';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { AuthModule } from '../auth/auth.module';
import { ExchangeRatesModule } from '../../common/exchange-rates/exchange-rates.module';
import { S3Module } from '../../common/s3/s3.module';

@Module({
  imports: [
    NotificationsModule,
    AdminModule,
    PrismaModule,
    IdempotencyModule,
    AuthModule,
    ExchangeRatesModule,
    S3Module,
    MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }), // max 5 MB CSV
  ],
  controllers: [EngagementsController],
  providers: [
    EngagementsService,
    SavedFiltersService,
    AuditLogService,
    IdempotencyInterceptor,
    // Focused sub-services extracted in #443
    EngagementNotesService,
    EngagementWatchersService,
    EngagementImportService,
    EngagementCandidateDetailsService,
    EngagementAttachmentsService,
  ],
  exports: [
    EngagementsService,
    AuditLogService,
    // Export sub-services so other modules (e.g. EventsModule) can inject them directly
    EngagementNotesService,
    EngagementWatchersService,
    EngagementImportService,
    EngagementCandidateDetailsService,
  ],
})
export class EngagementsModule {}
