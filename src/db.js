import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import sqlite3 from 'sqlite3';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

let pgPool = null;
let sqliteDb = null;
let dbType = 'sqlite';

export async function initDb() {
  const databaseUrl = process.env.DATABASE_URL;
  const forceSqlite = process.env.USE_SQLITE === 'true';

  if (!forceSqlite && databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
    const pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 2000,
    });
    pool.on('error', () => {}); // Catch unexpected pool errors
    try {
      const client = await pool.connect();
      client.release();
      pgPool = pool;
      dbType = 'postgres';
      logger.info('Connected to PostgreSQL database');

      const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pgPool.query(schema);
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'PostgreSQL connection failed. Using SQLite database.');
      pgPool = null;
    }
  }

  if (!pgPool) {
    dbType = 'sqlite';
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = process.env.SQLITE_DB_PATH || path.join(dataDir, 'gateway.db');

    await new Promise((resolve, reject) => {
      sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    logger.info({ path: dbPath }, 'Using SQLite database');

    const schemaPath = path.join(__dirname, '..', 'sql', 'sqlite_schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await new Promise((resolve, reject) => {
        sqliteDb.exec(schema, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  // Ensure default merchant wallet exists
  await query(
    `INSERT INTO wallets (id, name, created_at)
     VALUES ('default', 'Merchant Main Wallet', datetime('now'))
     ON CONFLICT (id) DO NOTHING`
  );

  // Ensure migrations for sweep columns
  try {
    if (dbType === 'sqlite') {
      const tableInfo = await query("PRAGMA table_info(invoices)");
      const colNames = new Set(tableInfo.rows.map(r => r.name));
      if (!colNames.has('sweep_status')) {
        await query("ALTER TABLE invoices ADD COLUMN sweep_status TEXT DEFAULT 'unswept'");
      }
      if (!colNames.has('sweep_txid')) {
        await query("ALTER TABLE invoices ADD COLUMN sweep_txid TEXT");
      }
      if (!colNames.has('swept_amount')) {
        await query("ALTER TABLE invoices ADD COLUMN swept_amount TEXT");
      }
      if (!colNames.has('swept_at')) {
        await query("ALTER TABLE invoices ADD COLUMN swept_at TEXT");
      }
      if (!colNames.has('sweep_error')) {
        await query("ALTER TABLE invoices ADD COLUMN sweep_error TEXT");
      }
      if (!colNames.has('merchant_id')) {
        await query("ALTER TABLE invoices ADD COLUMN merchant_id TEXT");
      }
      if (!colNames.has('wallet_id')) {
        await query("ALTER TABLE invoices ADD COLUMN wallet_id TEXT DEFAULT 'default'");
      }

      if (!colNames.has('customer_email')) {
        await query("ALTER TABLE invoices ADD COLUMN customer_email TEXT");
      }
      if (!colNames.has('customer_name')) {
        await query("ALTER TABLE invoices ADD COLUMN customer_name TEXT");
      }
      if (!colNames.has('order_id')) {
        await query("ALTER TABLE invoices ADD COLUMN order_id TEXT");
      }
      if (!colNames.has('description')) {
        await query("ALTER TABLE invoices ADD COLUMN description TEXT");
      }
      if (!colNames.has('receipt_email_sent')) {
        await query("ALTER TABLE invoices ADD COLUMN receipt_email_sent INTEGER DEFAULT 0");
      }

      // Check payment_links columns
      const plInfo = await query("PRAGMA table_info(payment_links)");
      const plCols = new Set(plInfo.rows.map(r => r.name));
      if (!plCols.has('merchant_id')) {
        await query("ALTER TABLE payment_links ADD COLUMN merchant_id TEXT");
      }
      if (!plCols.has('wallet_id')) {
        await query("ALTER TABLE payment_links ADD COLUMN wallet_id TEXT DEFAULT 'default'");
      }

      // Ensure merchants table exists
      await query(`
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
          wallet_id TEXT NOT NULL REFERENCES wallets(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await query("CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email)");
      await query("CREATE INDEX IF NOT EXISTS idx_merchants_api_key ON merchants(api_key)");
      await query("CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id)");
      await query("CREATE INDEX IF NOT EXISTS idx_payment_links_merchant ON payment_links(merchant_id)");
      await query("CREATE INDEX IF NOT EXISTS idx_invoices_customer_email ON invoices(customer_email)");

      await query(`
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
        )
      `);
      await query("CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id)");
      await query("CREATE INDEX IF NOT EXISTS idx_email_logs_merchant ON email_logs(merchant_id)");

      await query(`
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
        )
      `);
      await query("CREATE INDEX IF NOT EXISTS idx_invoices_sweep_status ON invoices(sweep_status)");
    } else {
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sweep_status TEXT DEFAULT 'unswept'");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sweep_txid TEXT");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS swept_amount NUMERIC(36,18)");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS swept_at TIMESTAMPTZ");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sweep_error TEXT");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS merchant_id TEXT");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT 'default'");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_email TEXT");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_name TEXT");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id TEXT");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT");
      await query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_email_sent INT DEFAULT 0");
      await query("ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS merchant_id TEXT");
      await query("ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT 'default'");
      await query(`
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
        )
      `);
      await query(`
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
        )
      `);
      await query("CREATE INDEX IF NOT EXISTS idx_invoices_sweep_status ON invoices(sweep_status)");
      await query("CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id)");
      await query("CREATE INDEX IF NOT EXISTS idx_payment_links_merchant ON payment_links(merchant_id)");
      await query("CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id)");
      await query("CREATE INDEX IF NOT EXISTS idx_email_logs_merchant ON email_logs(merchant_id)");
    }

    // Seed master admin account
    const { ensureAdminAccount } = await import('./auth.js');
    await ensureAdminAccount();
  } catch (migErr) {
    logger.warn({ err: migErr.message }, 'Migration check in initDb');
  }
}

export async function query(text, params = []) {
  if (dbType === 'postgres' && pgPool) {
    return await pgPool.query(text, params);
  }

  // SQLite execution: Map $1, $2, etc. correctly to ordered params array
  const orderedParams = [];
  let sqliteQuery = text.replace(/\$(\d+)/g, (match, num) => {
    const idx = parseInt(num, 10) - 1;
    orderedParams.push(params[idx]);
    return '?';
  });
  sqliteQuery = sqliteQuery.replace(/\bnow\(\)/gi, "datetime('now')");

  const finalParams = orderedParams.length > 0 ? orderedParams : params;
  const trimmed = sqliteQuery.trim();
  const isQueryWithResults = /^(?:SELECT|PRAGMA)\b/i.test(trimmed) || /RETURNING\b/i.test(trimmed);

  return new Promise((resolve, reject) => {
    if (isQueryWithResults) {
      sqliteDb.all(sqliteQuery, finalParams, (err, rows) => {
        if (err) {
          logger.error({ err: err.message, query: text, params: finalParams }, 'SQLite query error');
          return reject(err);
        }
        resolve({ rows: rows || [], rowCount: rows ? rows.length : 0 });
      });
    } else {
      sqliteDb.run(sqliteQuery, finalParams, function (err) {
        if (err) {
          logger.error({ err: err.message, query: text, params: finalParams }, 'SQLite run error');
          return reject(err);
        }
        resolve({ rows: [], rowCount: this.changes });
      });
    }
  });
}

export function getDbType() {
  return dbType;
}
