# Production architecture: managed USDT payments

## Scope and trust boundary

Launch one asset first: **USDT on BNB Smart Chain (chain ID 56)**, with its contract address configured only by deployment configuration. A payment is final for merchant fulfilment only when its transaction is mined successfully, matches the configured contract and invoice address, meets the exact base-unit amount, and reaches the invoice's confirmation policy.

The gateway is **not** a wallet. It owns no private key. The online tier holds a watch-only extended public key and assigns addresses. A separately controlled treasury tier collects and spends funds. This prevents a compromise of checkout, API, database, or indexer from becoming a direct loss of customer funds.

## Target system

```text
Customer wallet
  │ USDT Transfer event
  ▼
Independent BSC RPCs ──► Chain-indexer workers ──► Postgres ledger + outbox
                                      │                    │
Merchant dashboard/API ◄─ API service ◄┘                    ├──► webhook workers
  │ hosted checkout                       ▲                 └──► reconciliation/audit
  └──────────────► CDN/WAF/load balancer  │
                                         KMS/HSM audit logs

Offline / MPC or HSM quorum ──► treasury-signing service ──► BSC broadcast RPCs
                                      ▲
                       approved sweep / withdrawal workflow
```

Run the API, worker, and signer in separate identities, networks, and deployment accounts. The signer accepts only typed, policy-checked commands from an approval workflow; it is never a generic `signTransaction` endpoint.

## Services

| Service | Responsibility | Data/key access |
|---|---|---|
| Checkout/API | Merchant auth, invoice lifecycle, public payment view | Postgres; watch-only xpub |
| Indexer | Multi-RPC event ingestion, reorg handling, confirmation updates | Postgres; no signing key |
| Webhook worker | Transactional-outbox delivery, exponential retry, dead-letter queue | delivery rows and signing secret |
| Treasury | Balance discovery and unsigned sweep construction | read-only ledger, no web/API access |
| Signer | HSM/MPC policy approval and signing | signing material only |
| Compliance/ops | KYC/KYB, screening, limits, case management, support | least-privilege read access |

## Ledger and payment correctness

- Store chain amounts as integers (`amount_units`), never IEEE-754 numbers. Render decimals only at API/UI boundaries.
- Make `(chain_id, tx_hash, log_index)` unique. The current starter uses `(invoice_id, txid)`; expand it before accepting partial payments or more than one transfer in a transaction.
- Use an append-only double-entry ledger for customer liability, fees, merchant payable, treasury asset, and adjustments. Invoice status is a projection, not the financial source of truth.
- Persist the scanned block hash and cursor. On every poll, rescan a reorg window and roll back/replay orphaned events. Do not rely on a single RPC provider.
- Use an idempotency key for invoice creation and a transactional outbox for webhook events. Webhooks must be at-least-once, signed, retried, and independently queryable.
- Distinguish `detected`, `confirming`, `confirmed`, `underpaid`, `overpaid`, `expired`, `reorged`, and `refunded`. No automatic refund or sweep should bypass approval policy.

## Wallet and treasury model

1. Generate receiving address branches offline; load only validated external-chain xpubs into the API.
2. Maintain address-gap monitoring and never reuse an address within a merchant account.
3. Sweep USDT with a purpose-built service. Recipient addresses require allowlisting, amount/velocity limits, dual approval, simulation, and audit evidence.
4. Keep BNB gas funding in a separate, tightly limited operational wallet. Its compromise must not expose USDT reserves.
5. Use MPC or HSM-backed keys with role separation, quorum approval, rotations, disaster recovery drills, and immutable audit logs. NIST’s key-management guidance covers secure key generation, storage, use, and destruction across the key lifecycle. [NIST SP 800-57](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-57pt1r5.pdf)

## Security and reliability controls

- Put a WAF, TLS termination, rate limits, bot controls, DDoS protection, and strict CORS policy in front of the API. Authenticate merchants with scoped, rotatable API keys or OAuth client credentials; authorize every resource by merchant ID.
- Keep database, RPC, queues, and observability on private networks. Use a secret manager and workload identity rather than `.env` in production. Encrypt backups and test restoration.
- Allowlist webhook hosts and resolve/check them at delivery time to prevent SSRF; block private, loopback, link-local, and metadata IP ranges. The starter implements a hostname allowlist only; production needs the resolver check too.
- Alert on RPC disagreement, scan lag, reorgs, hot-wallet gas/balance limits, failed webhook rates, unusual payout activity, and reconciliation breaks.
- Retain immutable audit events for configuration, API-key, webhook, invoice, approval, and signing actions. Run SAST, dependency scanning, secrets scanning, infrastructure scanning, penetration tests, and an independent custody/security assessment before launch.

## Operations and compliance gates

Before launch, obtain jurisdiction-specific legal advice on money-transmission, virtual-asset, sanctions, consumer-protection, tax, privacy, and record-retention duties. Implement KYB/KYC, sanctions and wallet-risk screening, travel-rule handling where applicable, transaction limits, suspicious-activity case management, merchant agreements, incident response, and customer support processes. None of these can be safely replaced by code alone.

## Rollout

1. Testnet: synthetic merchants, test token only, reorg and outage drills.
2. Internal mainnet: receive-only and no automatic sweeps; reconcile every event against two RPC providers.
3. Limited merchants: small limits, manual fulfilment/sweeps, 24/7 alerts.
4. General availability: only after an independent audit, legal readiness, treasury drills, backup restore test, and sustained reconciliation accuracy.
