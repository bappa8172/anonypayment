import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'gateway.db');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('--- Cleaning Test Data from gateway.db ---');

  // 1. Delete test invoices
  db.run(`DELETE FROM invoices WHERE 
    merchant_id LIKE '%test%' OR 
    customer_email LIKE '%example%' OR 
    customer_email LIKE '%tron.org%' OR 
    customer_email LIKE '%nakamoto.me%' OR 
    customer_email LIKE '%domain.com%' OR
    description LIKE '%E-Commerce Order #8812%'`, function(err) {
    if (err) console.error('Error deleting test invoices:', err);
    else console.log('✓ Deleted test invoices:', this.changes);
  });

  // 2. Delete test transactions
  db.run(`DELETE FROM transactions WHERE 
    txid LIKE '%test%' OR 
    invoice_id NOT IN (SELECT id FROM invoices)`, function(err) {
    if (err) console.error('Error deleting test transactions:', err);
    else console.log('✓ Deleted test transactions:', this.changes);
  });

  // 3. Delete test ledger entries
  db.run(`DELETE FROM ledger WHERE 
    txid LIKE '%test%' OR 
    wallet_id LIKE '%test%' OR 
    wallet_id LIKE '%peer%' OR 
    note LIKE '%Refund failed withdrawal%' OR
    note LIKE '%Merchant payout withdrawal%'`, function(err) {
    if (err) console.error('Error deleting test ledger entries:', err);
    else console.log('✓ Deleted test ledger entries:', this.changes);
  });

  // 4. Delete test wallets & balances
  db.run(`DELETE FROM balances WHERE 
    wallet_id LIKE '%test%' OR 
    wallet_id LIKE '%peer%'`, function(err) {
    if (err) console.error('Error deleting test balances:', err);
    else console.log('✓ Deleted test balances:', this.changes);
  });

  db.run(`DELETE FROM wallets WHERE 
    id LIKE '%test%' OR 
    id LIKE '%peer%'`, function(err) {
    if (err) console.error('Error deleting test wallets:', err);
    else console.log('✓ Deleted test wallets:', this.changes);
  });

  // 5. Reset default wallet balances to actual verified settlements
  db.run(`UPDATE balances SET available_units = '20000000000000000', pending_units = '0', updated_at = datetime('now') WHERE wallet_id = 'default' AND currency = 'USDT_BSC'`, function(err) {
    if (err) console.error('Error updating default USDT balance:', err);
    else console.log('✓ Reset default USDT_BSC balance to verified on-chain settled 0.02 USDT');
  });

  db.run(`UPDATE balances SET available_units = '0', pending_units = '0', updated_at = datetime('now') WHERE wallet_id = 'default' AND currency IN ('USDT_TRC20', 'BTC')`, function(err) {
    if (err) console.error('Error resetting TRON/BTC balances:', err);
    else console.log('✓ Reset fake USDT_TRC20 and BTC default balances to 0.00');
  });

  // 6. Delete test merchants, email logs, otps
  db.run(`DELETE FROM merchants WHERE id LIKE '%test%'`, function(err) {
    if (err) console.error('Error deleting test merchants:', err);
    else console.log('✓ Deleted test merchants:', this.changes);
  });

  db.run(`DELETE FROM email_logs WHERE recipient LIKE '%example%' OR recipient LIKE '%tron.org%' OR recipient LIKE '%nakamoto.me%'`, function(err) {
    if (err) console.error('Error deleting test email logs:', err);
    else console.log('✓ Deleted test email logs:', this.changes);
  });

  db.run(`DELETE FROM otps WHERE email LIKE '%fintech.org%' OR email LIKE '%cybercorp.io%' OR email LIKE '%test%'`, function(err) {
    if (err) console.error('Error deleting test OTPs:', err);
    else console.log('✓ Deleted test OTPs:', this.changes);
  });

  // Run VACUUM to reclaim space and optimize
  db.run(`VACUUM`, function(err) {
    if (err) console.error('Error vacuuming DB:', err);
    else console.log('✓ Database vacuumed and optimized.');
  });
});

db.close(() => {
  console.log('--- Cleanup Finished Successfully ---');
});
