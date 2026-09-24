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
    const dbPath = path.join(dataDir, 'gateway.db');

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
      await query("CREATE INDEX IF NOT EXISTS idx_invoices_sweep_status ON invoices(sweep_status)");
    }
  } catch (migErr) {
    logger.warn({ err: migErr.message }, 'Migration check in initDb');
  }
}

export async function query(text, params = []) {
  if (dbType === 'postgres' && pgPool) {
    return await pgPool.query(text, params);
  }

  // SQLite execution
  let sqliteQuery = text.replace(/\$(\d+)/g, '?');
  sqliteQuery = sqliteQuery.replace(/\bnow\(\)/gi, "datetime('now')");

  const trimmed = sqliteQuery.trim();
  const isQueryWithResults = /^(?:SELECT|PRAGMA)\b/i.test(trimmed) || /RETURNING\b/i.test(trimmed);

  return new Promise((resolve, reject) => {
    if (isQueryWithResults) {
      sqliteDb.all(sqliteQuery, params, (err, rows) => {
        if (err) {
          logger.error({ err: err.message, query: text, params }, 'SQLite query error');
          return reject(err);
        }
        resolve({ rows: rows || [], rowCount: rows ? rows.length : 0 });
      });
    } else {
      sqliteDb.run(sqliteQuery, params, function (err) {
        if (err) {
          logger.error({ err: err.message, query: text, params }, 'SQLite run error');
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
