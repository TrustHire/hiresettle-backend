/**
 * Dev-only: generate a testnet keypair and fund it via Friendbot (#387).
 * Usage: npm run friendbot:fund
 */
import { FriendbotService } from '../src/modules/dev/friendbot.service';

new FriendbotService()
  .fund()
  .then((acct) => {
    console.log(JSON.stringify(acct, null, 2));
  })
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
