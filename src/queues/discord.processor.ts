import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { NotificationType } from "@prisma/client";
import { DiscordNotificationsService } from "../modules/notifications/discord-notifications.service";
import { QUEUE_DISCORD } from "./queues.module";

export interface DiscordJobData {
  webhookUrl: string;
  type: NotificationType;
  title: string;
  message: string;
}

@Processor(QUEUE_DISCORD)
export class DiscordProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscordProcessor.name);

  constructor(private readonly discord: DiscordNotificationsService) {
    super();
  }

  async process(job: Job<DiscordJobData>): Promise<void> {
    const { webhookUrl, type, title, message } = job.data;
    this.logger.log(
      `Posting Discord job ${job.id} (type: ${type}, attempt: ${job.attemptsMade + 1})`,
    );
    await this.discord.send(type, title, message, webhookUrl);
    this.logger.log(`Discord job ${job.id} delivered`);
  }
}
