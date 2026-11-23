# Stellar Transactions: Submission, Fees, and Failover

This document describes how the HireSettle backend queues, builds, signs, sponsors, and submits Stellar / Soroban transactions, as well as how Horizon failover and RPC circuit breaking protect against upstream outages.

## Transaction Submission Queue & Sequence Number Management

### BullMQ Submission Queue (`stellar-tx`)

Asynchronous contract calls are dispatched through the BullMQ `stellar-tx` queue (`QUEUE_STELLAR_TX`) and executed by `StellarTxProcessor` (`src/queues/stellar-tx.processor.ts`).

Supported `StellarTxJobData` actions:
- `release_payment` → `StellarService.releaseMilestonePayment(engagementId, milestoneIndex)`
- `resolve_dispute` → `StellarService.resolveMilestoneDispute(engagementId, milestoneIndex, approved)`
- `unlock_milestone` → `StellarService.unlockRetentionMilestone(engagementId, milestoneIndex)`

Running these mutations through BullMQ serializes/retries transient RPC or sequence-number failures instead of blocking HTTP request handlers.

### Sequence Number Management

1. **Account loading**: Before building a Soroban contract transaction, `StellarService` loads the current account sequence number from Soroban RPC / Horizon for the backend signing keypair (`STELLAR_SECRET_KEY`).
2. **Simulation & assembly**: Transactions are built with `TransactionBuilder` (with a 60-second timeout window), simulated via `rpcClient.simulateTransaction(tx)`, assembled via `SorobanRpc.assembleTransaction(tx, simulation).build()`, and signed with `backendKeypair`.
3. **Submission & polling**: The signed transaction is sent with `rpcClient.sendTransaction(prepared)`, then polled via `rpcClient.getTransaction(sendResult.hash)` every 2 seconds (up to 15 attempts / ~30 seconds) until it reaches `SUCCESS` or fails.
4. **Concurrency**: Because Stellar enforces strictly increasing per-account sequence numbers (`account_seq + 1`), concurrent submissions from the same source account can race. Enqueueing state-changing operations onto `stellar-tx` and relying on BullMQ retries mitigates `tx_bad_seq` collisions.

## Fee-Bump Sponsorship

`FeeSponsorshipService` (`src/modules/stellar/fee-sponsorship.service.ts`) lets the platform pay transaction fees on behalf of users via Stellar **fee-bump transactions** (`POST /api/v1/stellar/tx/sponsored`, guarded by `JwtOrApiKeyGuard`).

### How it works

1. The client signs the inner `Transaction` and submits its base64 XDR alongside `companyId`.
2. `FeeSponsorshipService.submit()` rejects XDR that is already a `FeeBumpTransaction`.
3. If `ENABLE_FEE_SPONSORSHIP` is not `'true'`, the inner transaction is submitted as-is (`sponsored: false`).
4. When enabled:
   - `assertWithinBudget()` checks today's UTC spend in the `sponsoredFee` table against `FEE_SPONSORSHIP_DAILY_CAP_XLM`.
   - `wrap()` computes a per-operation base fee (`max(floor(feeStroops / (ops + 1)), innerFee / ops, 100)`), builds a `FeeBumpTransaction` via `TransactionBuilder.buildFeeBumpTransaction()`, and signs it with the sponsor keypair.
   - After Horizon submission, the actual `fee_charged` (in stroops) is recorded in `prisma.sponsoredFee` against `companyId`.

### Configuration

| Environment Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_FEE_SPONSORSHIP` | `false` | Set to `true` to wrap user-signed transactions in a fee-bump. |
| `STELLAR_FEE_SPONSOR_SECRET` | Falls back to `STELLAR_SECRET_KEY` | Secret key of the platform fee-paying account. |
| `FEE_SPONSORSHIP_DAILY_CAP_XLM` | `100` | Maximum daily fee spend across all companies (in XLM). |
| `FEE_SPONSORSHIP_MAX_FEE_STROOPS` | `100000` | Maximum fee per sponsored fee-bump transaction (in stroops). |
| `FEE_SPONSORSHIP_WARN_RATIO` | `0.8` | Logs a `[ALERT]` warning when daily spend reaches this fraction of the cap. |

## Horizon Failover & Circuit Breaker

### Horizon Failover (`HorizonFailoverService`)

`HorizonFailoverService` (`src/common/stellar/horizon-failover.service.ts`) manages a prioritized list of Horizon endpoints and fails over automatically when the active endpoint accumulates consecutive errors.

| Environment Variable | Default | Description |
| --- | --- | --- |
| `HORIZON_URLS` | `""` | Comma-separated list of Horizon URLs (first is primary). Takes priority over `STELLAR_HORIZON_URL`. |
| `STELLAR_HORIZON_URL` | `""` | Single-URL fallback when `HORIZON_URLS` is not set. |
| `HORIZON_FAILOVER_THRESHOLD` | `3` | Consecutive fetch errors before switching to the next endpoint. |
| `HORIZON_RECOVERY_INTERVAL_MS` | `60000` | Interval (ms) for background recovery probes when multiple endpoints are configured. |

Endpoint health is surfaced on `GET /health` and `GET /health/ready` via `HealthService.isStellarHorizonHealthy()`.

### RPC Circuit Breaker (`CircuitBreakerService`)

`CircuitBreakerService` (`src/common/stellar/circuit-breaker.service.ts`) wraps outbound Stellar RPC/Horizon calls with `opossum` so sustained upstream failures fail fast rather than exhausting worker threads.

| Environment Variable | Default | Description |
| --- | --- | --- |
| `STELLAR_BREAKER_TIMEOUT` | `10000` | Max call duration in ms before timing out. |
| `STELLAR_BREAKER_ERROR_THRESHOLD` | `50` | Failure percentage (0–100) that trips the circuit open. |
| `STELLAR_BREAKER_RESET_TIMEOUT` | `30000` | Cooldown period in ms before transitioning to `half-open`. |
| `STELLAR_BREAKER_ROLLING_COUNT_TIMEOUT` | `10000` | Rolling window duration in ms for error-rate calculation. |
| `STELLAR_BREAKER_ROLLING_COUNT_BUCKETS` | `10` | Number of buckets in the rolling window. |

Prometheus metrics exposed:
- `stellar_circuit_breaker_state` (`0` = closed, `1` = open, `2` = half-open)
- `stellar_rpc_calls_total` (labeled by `result`: `success`, `failure`, `timeout`, `reject`, `fallback`)

## Troubleshooting

### `tx_bad_seq` (Sequence Number Mismatch)
- **Cause**: Two transactions for the same source account were built with the same sequence number concurrently, or a stale cached sequence number was used after another transaction landed on-ledger.
- **Resolution**:
  - Route backend-initiated contract calls through the `stellar-tx` BullMQ queue so retries re-fetch the latest account sequence number.
  - For client-signed sponsored transactions, instruct the client wallet to rebuild and re-sign the inner transaction with the current account sequence number.

### Insufficient Fee (`tx_insufficient_fee` / `tx_fee_bump_inner_failed`)
- **Cause**: Network surge pricing pushed the required base fee above the transaction's `fee`, or `FEE_SPONSORSHIP_MAX_FEE_STROOPS` is too low for a complex Soroban invocation.
- **Resolution**:
  - Check `GET /api/v1/stellar/fee-estimate` for current base and Soroban recommended fees.
  - Increase `FEE_SPONSORSHIP_MAX_FEE_STROOPS` if sponsored Soroban transactions are failing due to fee limits.
  - If `Daily fee sponsorship budget exhausted` is returned (`400 BadRequestException`), verify `FEE_SPONSORSHIP_DAILY_CAP_XLM` and `sponsored_fees` spend for the current UTC day.

### Timeouts & Open Circuit Breaker
- **Cause**: Horizon or Soroban RPC latency exceeded `STELLAR_BREAKER_TIMEOUT` (default 10s), or `getTransaction` polling exceeded 15 attempts (30s).
- **Resolution**:
  - Inspect `GET /health/ready` to see which Horizon endpoint is active and its `consecutiveErrors` count.
  - Configure multiple `HORIZON_URLS` so `HorizonFailoverService` can fail over automatically.
  - Check `stellar_circuit_breaker_state` in Prometheus; if `1` (open), wait for `STELLAR_BREAKER_RESET_TIMEOUT` (default 30s) or verify upstream RPC/Horizon reachability.
  - Query `GET /api/v1/stellar/tx/:hash` to check whether a timed-out submission actually landed on-ledger (final `success` / `failed` statuses are cached for 7 days).
