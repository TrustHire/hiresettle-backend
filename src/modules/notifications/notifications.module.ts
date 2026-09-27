import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationCleanupService } from "./notification-cleanup.service";
import { SlackNotificationsService } from "./slack-notifications.service";
import { DiscordNotificationsService } from "./discord-notifications.service";
import { notificationsPubSubProvider } from "./notification-pubsub";
import { EmailTemplateModule } from "../../common/email/email-template.module";

@Module({
  imports: [
    BullModule.registerQueue(
      { name: "email" },
      { name: "slack" },
      { name: "discord" },
    ),
  ],
  providers: [
    NotificationsService,
    NotificationCleanupService,
    SlackNotificationsService,
    DiscordNotificationsService,
    notificationsPubSubProvider,
  ],
  controllers: [NotificationsController],
  exports: [
    NotificationsService,
    SlackNotificationsService,
    DiscordNotificationsService,
    notificationsPubSubProvider,
  ],
})
export class NotificationsModule {}
