import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { xdr } from '@stellar/stellar-sdk';
import { StellarService } from '../../common/stellar/stellar.service';
import { CacheService } from '../../common/cache/cache.service';

export type TxStatus = 'pending' | 'success' | 'failed';

export interface TxStatusResponse {
  hash: string;
  status: TxStatus;
  ledger: number | null;
  createdAt: string | null;
  feeCharged: string | null;
  resultCode: string | null;
  operationResultCodes: string[];
  cached: boolean;
}

const FINAL_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Looks up transaction status on Horizon (#385). Final statuses (success /
 * failed) are immutable, so they are cached and never re-fetched.
 */
@Injectable()
export class StellarTxStatusService {
  private readonly logger = new Logger(StellarTxStatusService.name);

  constructor(
    private readonly stellar: StellarService,
    private readonly cache: CacheService,
  ) {}

  static cacheKey(hash: string) {
    return `stellar:tx-status:${hash}`;
  }

  async getStatus(hash: string): Promise<TxStatusResponse> {
    const cached = await this.cache.get<TxStatusResponse>(StellarTxStatusService.cacheKey(hash));
    if (cached) return { ...cached, cached: true };

    const res = await fetch(`${this.stellar.getHorizonUrl()}/transactions/${hash}`);
    if (res.status === 404) {
      throw new NotFoundException(`Transaction ${hash} not found on Horizon`);
    }
    if (!res.ok) {
      throw new Error(`Horizon returned ${res.status} for transaction ${hash}`);
    }
    const body: any = await res.json();

    const status: TxStatus = !body.ledger ? 'pending' : body.successful ? 'success' : 'failed';
    const decoded = StellarTxStatusService.decodeResult(body.result_xdr);

    const result: TxStatusResponse = {
      hash,
      status,
      ledger: body.ledger ?? null,
      createdAt: body.created_at ?? null,
      feeCharged: body.fee_charged != null ? String(body.fee_charged) : null,
      resultCode: decoded.resultCode,
      operationResultCodes: decoded.operationResultCodes,
      cached: false,
    };

    if (status !== 'pending') {
      await this.cache.set(StellarTxStatusService.cacheKey(hash), result, FINAL_CACHE_TTL_SECONDS);
    }
    return result;
  }

  /** Decodes a base64 TransactionResult XDR into human-readable result codes. */
  static decodeResult(resultXdr?: string): { resultCode: string | null; operationResultCodes: string[] } {
    if (!resultXdr) return { resultCode: null, operationResultCodes: [] };
    try {
      const txResult = xdr.TransactionResult.fromXDR(resultXdr, 'base64');
      let inner: any = txResult.result();
      const resultCode = inner.switch().name as string;

      // Fee-bump wrappers nest the inner transaction result.
      if (resultCode === 'txFeeBumpInnerSuccess' || resultCode === 'txFeeBumpInnerFailed') {
        inner = inner.innerResultPair().result().result();
      }

      let ops: any[] = [];
      try {
        ops = inner.results() ?? [];
      } catch {
        ops = [];
      }
      const operationResultCodes = ops.map((op: any) => {
        try {
          const tr = op.tr();
          const opResult = tr.value();
          return opResult?.switch ? opResult.switch().name : tr.switch().name;
        } catch {
          return op.switch().name;
        }
      });
      return { resultCode, operationResultCodes };
    } catch (e) {
      return { resultCode: null, operationResultCodes: [] };
    }
  }
}
