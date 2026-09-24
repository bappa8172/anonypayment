CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  business_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'merchant',
  status TEXT NOT NULL DEFAULT 'active',
  api_key TEXT UNIQUE NOT NULL,
  webhook_url TEXT,
  webhook_secret TEXT NOT NULL,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  payload TEXT,
  attempts INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  address TEXT NOT NULL,
  amount TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmations_required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  confirmed_at TEXT,
  txid TEXT,
  webhook_url TEXT,
  metadata TEXT,
  token_contract TEXT,
  derivation_index INTEGER,
  merchant_id TEXT REFERENCES merchants(id),
  wallet_id TEXT DEFAULT 'default' REFERENCES wallets(id),
  customer_email TEXT,
  customer_name TEXT,
  order_id TEXT,
  description TEXT,
  receipt_email_sent INTEGER DEFAULT 0,
  sweep_status TEXT DEFAULT 'unswept',
  sweep_txid TEXT,
  swept_amount TEXT,
  swept_at TEXT,
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id),
  txid TEXT NOT NULL,
  amount TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  raw TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balances (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  currency TEXT NOT NULL,
  available_units TEXT NOT NULL DEFAULT '0',
  pending_units TEXT NOT NULL DEFAULT '0',
  updated_at TEXT NOT NULL,
  UNIQUE(wallet_id, currency)
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  type TEXT NOT NULL,
  txid TEXT,
  destination_address TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  redirect_url TEXT,
  merchant_id TEXT REFERENCES merchants(id),
  wallet_id TEXT DEFAULT 'default' REFERENCES wallets(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweeps (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id),
  currency TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  txid TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_api_key ON merchants(api_key);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_address ON invoices(address);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id ON transactions(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_invoice_txid ON transactions(invoice_id, txid);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger(wallet_id);
CREATE INDEX IF NOT EXISTS idx_sweeps_invoice_id ON sweeps(invoice_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_merchant ON email_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_otps_email_purpose ON otps(email, purpose);

