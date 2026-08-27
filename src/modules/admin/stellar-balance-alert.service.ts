import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';

const BALANCE_BREACH_KEY = 'stellar_balance_alert_breached';

@Injectable()
export class StellarBalanceAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StellarBalanceAlertService.name);
  private interval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    const intervalMs = this.config.get<number>(
      'STELLAR_BALANCE_ALERT_INTERVAL_MS',
      300000,
    );
    this.interval = setInterval(() => {
      void this.checkBalance();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  async checkBalance(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const address = this.stellar.getBackendAccountAddress();
      if (!address) return;

      const balance = await this.stellar.getBackendAccountBalance();
      const threshold = BigInt(
        this.config.get<number>('STELLAR_BALANCE_ALERT_THRESHOLD_STROOPS', 10000000),
      );
      const breached = balance < threshold;
      const state = await this.prisma.systemConfig.findUnique({
        where: { key: BALANCE_BREACH_KEY },
      });
      const wasBreached = state?.value === 'true';

      if (!breached) {
        if (wasBreached) {
          await this.prisma.systemConfig.upsert({
            where: { key: BALANCE_BREACH_KEY },
            create: { key: BALANCE_BREACH_KEY, value: 'false' },
            update: { value: 'false' },
          });
        }
        return;
      }

      if (wasBreached) return;

      await this.prisma.systemConfig.upsert({
        where: { key: BALANCE_BREACH_KEY },
        create: { key: BALANCE_BREACH_KEY, value: 'true' },
        update: { value: 'true' },
      });

      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', deactivatedAt: null },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.notifications.notifyUserById(
          admin.id,
          'STELLAR_BALANCE_LOW' as NotificationType,
          'Stellar Account Balance Low',
          `The configured Stellar account ${address} has a balance of ${balance} stroops, below the alert threshold of ${threshold} stroops.`,
          { address, balance: balance.toString(), threshold: threshold.toString() },
        );
      }
    } catch (error) {
      this.logger.error(
        'Stellar balance alert check failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}