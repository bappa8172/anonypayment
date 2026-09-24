CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'merchant',
  status TEXT NOT NULL DEFAULT 'active',
  api_key TEXT UNIQUE NOT NULL,
  webhook_url TEXT,
  webhook_secret TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency TEXT NOT NULL,
  address TEXT NOT NULL,
  amount NUMERIC(36,18) NOT NULL,
  amount_units NUMERIC(78,0) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmations_required INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  txid TEXT,
  webhook_url TEXT,
  metadata JSONB,
  token_contract TEXT,
  derivation_index INT,
  merchant_id TEXT REFERENCES merchants(id),
  wallet_id TEXT DEFAULT 'default',
  customer_email TEXT,
  customer_name TEXT,
  order_id TEXT,
  description TEXT,
  receipt_email_sent INT DEFAULT 0,
  sweep_status TEXT DEFAULT 'unswept',
  sweep_txid TEXT,
  swept_amount NUMERIC(36,18),
  swept_at TIMESTAMPTZ,
  sweep_error TEXT
);

CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  invoice_id TEXT REFERENCES invoices(id),
  merchant_id TEXT REFERENCES merchants(id),
  status TEXT NOT NULL,
  error TEXT,
  preview_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  txid TEXT NOT NULL,
  amount NUMERIC(36,18) NOT NULL,
  amount_units NUMERIC(78,0) NOT NULL,
  confirmations INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  currency TEXT NOT NULL,
  available_units NUMERIC(78,0) NOT NULL DEFAULT 0,
  pending_units NUMERIC(78,0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(wallet_id, currency)
);

CREATE TABLE IF NOT EXISTS ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  currency TEXT NOT NULL,
  amount NUMERIC(36,18) NOT NULL,
  amount_units NUMERIC(78,0) NOT NULL,
  type TEXT NOT NULL,
  txid TEXT,
  destination_address TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL,
  amount NUMERIC(36,18) NOT NULL,
  redirect_url TEXT,
  merchant_id TEXT REFERENCES merchants(id),
  wallet_id TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweeps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  currency TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount NUMERIC(36,18) NOT NULL,
  amount_units NUMERIC(78,0) NOT NULL,
  txid TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_api_key ON merchants(api_key);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_address ON invoices(address);
CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id ON transactions(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_invoice_txid ON transactions(invoice_id, txid);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger(wallet_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_merchant ON payment_links(merchant_id);
CREATE INDEX IF NOT EXISTS idx_sweeps_invoice_id ON sweeps(invoice_id);
