import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayoutsController } from './payouts.controller';
import { ClaimableBalancesController } from './claimable-balances.controller';
import { PayoutsService } from './payouts.service';
import { PayoutPollerService } from './payout-poller.service';
import { Sep24ClientService } from './sep24-client.service';
import { PayoutDeliveryService } from './payout-delivery.service';
import { ClaimableBalancesService } from './claimable-balances.service';

/**
 * Global so milestone release paths (milestones, proof SLA, stellar-tx queue)
 * can inject PayoutDeliveryService without new module wiring.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  // ClaimableBalancesController first so /payouts/claimable-balances is not captured by /payouts/:id
  controllers: [ClaimableBalancesController, PayoutsController],
  providers: [
    Sep24ClientService,
    PayoutsService,
    PayoutPollerService,
    PayoutDeliveryService,
    ClaimableBalancesService,
  ],
  exports: [PayoutDeliveryService, PayoutsService],
})
export class PayoutsModule {}
