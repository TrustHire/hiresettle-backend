# Stellar Integration Guide

## Overview

HireSettle uses a Soroban smart contract on the Stellar network to hold recruiter fees in escrow and release them when milestones are confirmed. The backend interacts with the contract via the Stellar RPC API and the Horizon REST API.

## Soroban Contract Interface

The contract is deployed at the address specified by `HIRESETTLE_CONTRACT_ID`. The backend calls the following contract functions:

| Function | Direction | Description |
|----------|-----------|-------------|
| `is_milestone_unlockable(engagement_id, milestone_index)` | Read | Returns `true` if the retention ledger has passed |
| `ledgers_until_unlock(engagement_id, milestone_index)` | Read | Returns remaining ledgers until the retention milestone unlocks |
| `unlock_milestone(engagement_id, milestone_index)` | Write | Called from frontend (Freighter wallet); backend only checks, does not call |
| `release_payment(engagement_id, milestone_index)` | Write | Releases escrowed funds to the recruiter on confirmation |
| `resolve_dispute(engagement_id, milestone_index, approved)` | Write | Arbiter decision: `approved=true` releases payment, `false` returns to company |

Contract events emitted (polled by `EventsService`):
- `milestone_confirmed` — payment released
- `milestone_disputed` — dispute raised by company
- `dispute_resolved` — arbiter resolved the dispute
- `replacement_requested` — company requested a candidate replacement
- `account_merge_detected` — a party's Stellar account was merged (fraud detection)

## Network Configuration

### Testnet

Set these in `.env` for local development and CI:

```env
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
HIRESETTLE_CONTRACT_ID=C...  # deployed testnet contract address
```

### Mainnet (Pubnet)

```env
STELLAR_NETWORK=mainnet
STELLAR_RPC_URL=https://soroban-rpc.stellar.org
STELLAR_HORIZON_URL=https://horizon.stellar.org
HIRESETTLE_CONTRACT_ID=C...  # deployed mainnet contract address
```

## Getting Testnet Funds (Faucet)

To fund a Stellar testnet account for testing:

```bash
# Using the Stellar CLI
stellar account fund <YOUR_STELLAR_ADDRESS> --network testnet

# Or via curl (Friendbot)
curl "https://friendbot.stellar.org?addr=<YOUR_STELLAR_ADDRESS>"
```

You can also use the Stellar Laboratory at `https://laboratory.stellar.org` → Friendbot.

The backend's `STELLAR_SECRET_KEY` account is read-only — it does not need funds for event polling. Only the frontend (Freighter wallet) submits funded transactions.

## Read-Only Backend Account

The backend uses a **read-only** Stellar keypair to poll contract events and query contract state:

```env
STELLAR_SECRET_KEY=S...  # private key of the read-only account
```

This account:
- Does **not** hold user funds
- Only submits read-only `simulateTransaction` calls
- Never signs fund-moving transactions

Generate a fresh keypair for this purpose:
```bash
stellar keypair generate --network testnet
```

## Allowed Tokens

`ALLOWED_TOKENS` is a JSON array of token contracts accepted by the escrow contract:

```env
ALLOWED_TOKENS=[{"address":"CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA","symbol":"USDC","decimals":7}]
```

Each token object:
- `address` — the SEP-41 token contract address
- `symbol` — display name used in notifications
- `decimals` — for amount formatting (7 = stroops for USDC)

## Event Polling

`EventsService` runs a cron job every `EVENT_POLLING_INTERVAL_MS` milliseconds (default 5000). It:
1. Reads `lastProcessedLedger` from memory (TODO: persist to DB — see production checklist in README)
2. Calls `getEvents` on the Stellar RPC for events since that ledger
3. Persists each event to `ChainEvent` table (idempotent — duplicates are skipped)
4. Dispatches each event through the appropriate handler to update milestone state

Failed event processing is retried by `ChainEventRetryService` and moved to `DeadLetterEvent` after 3 failures.

## Retention Timer Math

Stellar produces approximately 1 ledger every 5 seconds, so:

```
LEDGERS_PER_DAY = 86400 / 5 = 17280
validAfterLedger = engagementLedger + (retentionDays × 17280)
unlockEstimatedAt = now + ((validAfterLedger - currentLedger) × 5s)
```

These are estimates — the exact unlock time depends on actual ledger close times, which vary slightly. The `GET /engagements/:id/milestones/:index/timer` endpoint queries the chain directly for the precise remaining ledger count.
