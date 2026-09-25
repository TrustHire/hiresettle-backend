import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';

export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

export interface FundedAccount {
  publicKey: string;
  secretKey: string;
  balance: string;
}

/** Throws unless running against testnet outside production (#387). */
export function assertFriendbotAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const network = (env.STELLAR_NETWORK ?? 'testnet').toLowerCase();
  if (network === 'mainnet' || env.NODE_ENV === 'production') {
    throw new ForbiddenException('Friendbot funding is disabled on mainnet / production');
  }
}

/** Dev-only helper: generates a keypair and funds it via testnet Friendbot (#387). */
@Injectable()
export class FriendbotService {
  private readonly logger = new Logger(FriendbotService.name);

  async fund(env: NodeJS.ProcessEnv = process.env): Promise<FundedAccount> {
    assertFriendbotAllowed(env);

    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const friendbotUrl = env.STELLAR_FRIENDBOT_URL ?? FRIENDBOT_URL;
    const horizonUrl = env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

    const res = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
    if (!res.ok) {
      throw new Error(`Friendbot funding failed (${res.status}): ${await res.text()}`);
    }

    let balance = '0';
    const account = await fetch(`${horizonUrl}/accounts/${publicKey}`);
    if (account.ok) {
      const body: any = await account.json();
      balance = body.balances?.find((b: any) => b.asset_type === 'native')?.balance ?? '0';
    }

    this.logger.log(`Funded testnet account ${publicKey} with ${balance} XLM`);
    return { publicKey, secretKey: keypair.secret(), balance };
  }
}
