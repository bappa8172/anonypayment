import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, query } from '../src/db.js';
import { initEVM, getCentralTreasuryAddress, getTreasuryPrivateKey, isWatchOnlyWallet } from '../src/evm.js';
import { createInvoice, getInvoice } from '../src/invoices.js';
import {
  getCentralTreasuryOverview,
  sweepInvoice,
  sweepAllUnswept,
  getSweepsHistory,
} from '../src/sweeper.js';

test('Treasury & Sweeper: 1. EVM Central Treasury Master Address initialization', async () => {
  await initDb();
  await initEVM();

  const treasuryAddress = getCentralTreasuryAddress();
  assert.ok(treasuryAddress);
  assert.match(treasuryAddress, /^0x[a-fA-F0-9]{40}$/);

  const privateKey = getTreasuryPrivateKey();
  assert.ok(privateKey);
  assert.match(privateKey, /^0x[a-fA-F0-9]{64}$/);
  assert.equal(isWatchOnlyWallet(), false);
});

test('Treasury & Sweeper: 2. Central Treasury live overview returns balances and status', async () => {
  const overview = await getCentralTreasuryOverview();

  assert.ok(overview.treasuryAddress);
  assert.match(overview.treasuryAddress, /^0x[a-fA-F0-9]{40}$/);
  assert.equal(overview.hasHotSigner, true);
  assert.equal(overview.isWatchOnly, false);
  assert.ok(Array.isArray(overview.onChainBalances));
  assert.ok(overview.onChainBalances.length >= 4);

  // Check supported assets are present
  const symbols = overview.onChainBalances.map(b => b.symbol);
  assert.ok(symbols.includes('BNB'));
  assert.ok(symbols.includes('USDT'));
  assert.ok(symbols.includes('ETH'));
});

test('Treasury & Sweeper: 3. Invoice creation tracks sweep_status', async () => {
  const inv = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.05',
    expiresInMinutes: 30,
  });

  assert.ok(inv.id);
  const fetched = await getInvoice(inv.id);
  assert.equal(fetched.sweep_status, 'unswept');
  assert.equal(fetched.sweep_txid, null);
  assert.equal(fetched.swept_amount, null);
});

test('Treasury & Sweeper: 4. Sweeper checks invoice confirmation status before sweeping', async () => {
  const inv = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.01',
  });

  // Attempting to sweep pending invoice should reject unless forced
  await assert.rejects(async () => {
    await sweepInvoice(inv.id, { force: false });
  }, /not confirmed yet/);
});

test('Treasury & Sweeper: 5. Sweeper handles zero-balance / dust on simulated confirmed invoice', async () => {
  const inv = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.005',
  });

  // Mark invoice confirmed in DB
  await query("UPDATE invoices SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = $1", [inv.id]);

  // Attempt sweep (child address has 0 live balance on testnet)
  const result = await sweepInvoice(inv.id);
  assert.ok(['zero_balance', 'dust', 'swept', 'already_at_treasury'].includes(result.status));

  const afterSweep = await getInvoice(inv.id);
  assert.ok(['swept', 'dust', 'unswept'].includes(afterSweep.sweep_status));
});

test('Treasury & Sweeper: 6. Sweeps history and settings audit', async () => {
  const history = await getSweepsHistory(10);
  assert.ok(Array.isArray(history));

  // Update treasury settings
  await query("INSERT INTO settings (key, value) VALUES ('auto_sweep_enabled', 'true') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  await query("INSERT INTO settings (key, value) VALUES ('cold_storage_address', '0x1111111111111111111111111111111111111111') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");

  const overview = await getCentralTreasuryOverview();
  assert.equal(overview.autoSweepEnabled, true);
  assert.equal(overview.coldStorageAddress, '0x1111111111111111111111111111111111111111');
});
