# Glossary

Domain-specific terms used throughout HireSettle.

| Term | Definition |
|------|------------|
| **Engagement** | A hiring agreement between a company, a recruiter, and an arbiter, backed by escrowed funds on the Stellar blockchain. The top-level entity in the HireSettle domain model; stored off-chain in PostgreSQL and mirrored on-chain via a Soroban contract. |
| **Milestone** | A discrete payment stage within an engagement. Each milestone has a `kind` (PLACEMENT or RETENTION), a percentage of the total fee, and a state machine (LOCKED → PENDING → PROOF_SUBMITTED → CONFIRMED / DISPUTED → RESOLVED). |
| **Retention Timer** | A ledger-based countdown that controls when a RETENTION milestone unlocks. Stellar produces one ledger every ~5 s, so the timer is tracked as a target ledger sequence (`validAfterLedger`). The backend pre-calculates the estimated wall-clock unlock time and stores it in the `RetentionSchedule` table. See [Stellar Integration — Retention Timer Math](stellar-integration.md#retention-timer-math). |
| **Escrow** | The on-chain pool that holds recruiter fees until milestones are confirmed. Funds are deposited by the company at engagement creation and released to the recruiter by calling `release_payment` on the contract. The backend never holds funds itself. |
| **Arbiter** | A trusted third-party user assigned to an engagement at creation time. The arbiter reviews disputes and calls `resolve_dispute` on-chain — approving releases payment to the recruiter, rejecting returns funds to the company. Arbiters may recuse themselves. |
| **Soroban** | Stellar's smart contract platform. HireSettle's escrow logic lives in a Soroban contract (Rust, in the `hiresettle-contract` repo). The backend interacts with it via the Soroban RPC API — `simulateTransaction` for reads, signed transactions for writes. |
| **Horizon** | Stellar's REST API server for querying ledger history, account balances, and transaction results. HireSettle uses Horizon for token balance checks, a secondary event indexer (`HorizonIndexerService`), and account-merge fraud detection. Distinct from Soroban RPC. |
