# Payrail — Cryptocurrency Payment Gateway & Multi-Currency Wallet

Payrail is an enterprise-grade, self-hosted cryptocurrency payment gateway and wallet management platform with **real live blockchain connectivity** (BNB Smart Chain, Ethereum/Sepolia, Polygon), on-chain deposit monitoring, real payout/withdrawal engine, Web3-enabled hosted checkout with QR codes, and a full Merchant & Wallet Dashboard.

---

## 🚀 Key Features

### 1. Real Blockchain Integration (No Fake / Mock Data)
- **Supported Blockchains & Cryptocurrencies**:
  - `BNB_BSC`: Native BNB on BNB Smart Chain (Testnet & Mainnet)
  - `USDT_BSC`: Tether USD on BNB Smart Chain (BEP-20)
  - `ETH_SEPOLIA`: Native Ethereum on Sepolia Testnet (free faucet real testing)
  - `USDT_SEPOLIA`: Tether USD on Sepolia Testnet (ERC-20)
  - `MATIC_POLYGON`: Native Polygon POL/MATIC
- **Live Public RPC Integration**: Auto-connects to high-performance live RPC nodes with real-time block and gas fee monitoring.
- **Deterministic HD Address Derivation**: Standard BIP-44 path (`m/44'/60'/0'/0/index`) generating genuine on-chain `0x...` addresses for every invoice and wallet deposit.

### 2. Central Wallet (Treasury Vault) & Sweeper Engine ("central walete")
- **Master Treasury Vault**: Centralizes on-chain custody into a single master address (`deriveAddress(0)` or configured cold/hot wallet).
- **Automated Sweeping**: As soon as customer payments are confirmed on unique derived invoice addresses, the sweeper engine automatically forwards them to the Central Treasury Vault.
- **Gas Fee Sponsorship**: For ERC-20 / BEP-20 tokens (like USDT), the Treasury hot wallet sponsors gas to child addresses when needed to execute the token sweep!
- **1-Click Batch Sweep**: Sweep all pending unswept customer payments on demand from the dashboard or via API (`POST /admin/treasury/sweep`).
- **Live On-Chain Balances**: Direct real-time queries against public RPCs showing actual blockchain balances held in the Central Treasury.
- **Cold Storage Forwarding**: Option to route funds and on-chain payouts directly from the Central Treasury to hardware wallets (Ledger, Trezor) or exchange accounts.
- **Sweeps Audit Trail**: Full ledger and `sweeps` journal logging every sweep transaction hash, timestamps, amounts, and explorer links.

### 3. Multi-Currency Wallet & Ledger System
- **Balance Management**: Real-time tracking of `available` and `pending` balances across all supported assets.
- **Permanent Deposit Addresses**: Unique derived deposit addresses with instant QR codes for merchant and user wallets.
- **Real On-Chain Withdrawals & Payouts**: Signs raw EVM transactions with ECDSA cryptography and broadcasts them to the blockchain via RPC, returning real `txid` hashes verifiable on BscScan / Etherscan.
- **Double-Entry Ledger Journal**: Immutable audit trail recording `DEPOSIT`, `WITHDRAWAL`, `INVOICE_SETTLEMENT`, `SWEEP_TO_TREASURY`, `INTERNAL_TRANSFER`, and `FEE`.
- **Instant Internal Transfers**: Zero-fee instant transfers between merchant/user accounts.

### 4. Hosted Checkout (`/pay?invoice=<id>`)
- High-resolution wallet-compatible QR Code generation.
- One-click copy for exact amount and deposit address.
- **"Pay with MetaMask / Web3"** button: Auto-switches network in browser wallet, signs the exact transaction with 1 click, and verifies on-chain immediately.
- Live status updates (`pending` → `paid` → `confirmed`) and countdown timer.
- Direct links to blockchain explorers (BscScan, Etherscan).

### 5. Merchant Dashboard (`/dashboard`)
- **Overview**: Gateway metrics, total invoice volume, wallet net worth.
- **Central Wallet (Treasury)**: Live on-chain balances, master vault address with QR, batch sweep button, and sweep audit log.
- **Invoices**: Manage, search, filter, and create multi-currency invoices.
- **Crypto Wallet**: Visual balance cards, deposit modal with QR code, and real withdrawal payout modal.
- **Ledger**: Complete transaction audit log with block explorer links.
- **Payment Links**: Create reusable payment links and copy embeddable HTML Buy Buttons.
- **API & Settings**: API Key management, webhook testing, and active RPC status.

### 6. Dual-Mode Database Architecture
- **SQLite Out-of-the-Box**: Runs locally with zero dependencies or Docker required (`data/gateway.db` via `sqlite3`).
- **PostgreSQL Ready**: Automatically switches to PostgreSQL when `DATABASE_URL` is configured for production.

---

## 🛠️ Quick Start

### 1. Install & Start
```bash
npm install
npm start
```

Open your browser:
- **Merchant Dashboard**: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- **Hosted Checkout**: `http://localhost:3000/pay?invoice=<id>`
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)

### 2. Run Tests
```bash
npm test
```

---

## 🔑 Environment Configuration (`.env`)

```env
PORT=3000
NODE_ENV=development
NETWORK_MODE=testnet  # Set to 'mainnet' for real production funds

# Admin API Key (Min 32 characters)
ADMIN_API_KEY=gateway_admin_secret_key_prod_test_32chars

# Webhook Secret (Min 32 characters)
WEBHOOK_SECRET=gateway_webhook_secret_key_test_32chars
WEBHOOK_ALLOWED_HOSTS=*

# Database: SQLite is active by default.
USE_SQLITE=true
# DATABASE_URL=postgres://gateway:gateway@localhost:5432/gateway

# EVM RPC Configuration (BSC Testnet by default)
EVM_RPC_URL=https://bsc-testnet.publicnode.com
EVM_CHAIN_ID=97
EVM_CONFIRMATIONS=2

# Optional: Master HD Mnemonic or XPUB (auto-generated in DB if omitted)
# EVM_MNEMONIC=
# EVM_XPUB=

# Optional: Hot wallet private key for automated on-chain payouts
# TREASURY_PRIVATE_KEY=
```

---

## 📡 API Reference

### Create an Invoice
```bash
curl -X POST http://localhost:3000/admin/invoices \
  -H "X-API-Key: gateway_admin_secret_key_prod_test_32chars" \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "BNB_BSC",
    "amount": "0.05",
    "expiresInMinutes": 30
  }'
```

### Query Wallet Balances
```bash
curl http://localhost:3000/admin/wallet \
  -H "X-API-Key: gateway_admin_secret_key_prod_test_32chars"
```

### Query Central Treasury Vault (Live On-Chain Balances & Sweeps)
```bash
curl http://localhost:3000/admin/treasury \
  -H "X-API-Key: gateway_admin_secret_key_prod_test_32chars"
```

### Trigger 1-Click Sweep to Central Treasury
```bash
curl -X POST http://localhost:3000/admin/treasury/sweep \
  -H "X-API-Key: gateway_admin_secret_key_prod_test_32chars"
```

### Direct Treasury Payout / Cold Storage Transfer
```bash
curl -X POST http://localhost:3000/admin/treasury/payout \
  -H "X-API-Key: gateway_admin_secret_key_prod_test_32chars" \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "BNB_BSC",
    "toAddress": "0xYourColdStorageAddress...",
    "amount": "0.1",
    "note": "Sweep profit to Cold Storage Ledger"
  }'
```

### Request Merchant Ledger Withdrawal
```bash
curl -X POST http://localhost:3000/admin/wallet/withdraw \
  -H "X-API-Key: gateway_admin_secret_key_prod_test_32chars" \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "BNB_BSC",
    "toAddress": "0xYourDestinationAddress...",
    "amount": "0.01",
    "note": "Merchant payout"
  }'
```
