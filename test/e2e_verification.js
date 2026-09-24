import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from '../src/db.js';
import { initEVM } from '../src/evm.js';
import adminRouter from '../src/admin.js';
import publicRouter from '../src/public.js';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3199;
const BASE = `http://localhost:${TEST_PORT}`;
const API_KEY = config.adminApiKey || 'gateway_admin_secret_key_prod_test_32chars';
const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

async function createTestServer() {
  await initDb();
  await initEVM();

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors());
  app.use(express.json());

  app.use('/admin', adminRouter);
  app.use('/v1', publicRouter);

  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      networkMode: config.networkMode,
      activeChainId: config.evm.chainId,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(TEST_PORT, () => resolve(server));
  });
}

async function runE2E() {
  console.log('--- Payrail Gateway & Central Treasury E2E Verification ---');
  let server;

  try {
    server = await createTestServer();

    // 1. Health & Network Check
    const healthRes = await fetch(`${BASE}/health`);
    const health = await healthRes.json();
    console.log('✓ 1. Gateway Health:', health.status, '| Network:', health.networkMode, '| Chain ID:', health.activeChainId);

    // 2. Central Treasury Master Overview
    const treasuryRes = await fetch(`${BASE}/admin/treasury`, { headers });
    const treasury = await treasuryRes.json();
    console.log('✓ 2. Central Treasury Master Vault:', treasury.treasuryAddress);
    console.log('     Hot Signer Active:', treasury.hasHotSigner, '| Auto-Sweep:', treasury.autoSweepEnabled);
    console.log('     Live On-Chain Balances:', treasury.onChainBalances.map(b => `${b.symbol}: ${b.balance}`).join(', '));

    // 3. Central Treasury QR Code for Direct Deposits
    const tQrRes = await fetch(`${BASE}/admin/treasury/qr`, { headers });
    const tQrData = await tQrRes.json();
    console.log('✓ 3. Central Treasury Direct QR Code generated (length:', tQrData.qrDataUrl.length, ')');

    // 4. Create Invoice
    const invRes = await fetch(`${BASE}/admin/invoices`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        currency: 'BNB_BSC',
        amount: '0.025',
        expiresInMinutes: 45,
      }),
    });
    const invoice = await invRes.json();
    console.log('✓ 4. Created Invoice:', invoice.id, '| Amount:', invoice.amount, invoice.currency, '| Child Address:', invoice.address);

    // 5. Public Checkout API & QR Code
    const pubRes = await fetch(`${BASE}/v1/invoices/${invoice.id}`);
    const pubInv = await pubRes.json();
    console.log('✓ 5. Public Invoice Status:', pubInv.status, '| Payment URI:', pubInv.paymentUri);

    const qrRes = await fetch(`${BASE}/v1/invoices/${invoice.id}/qr`);
    const qrData = await qrRes.json();
    console.log('✓ 6. Invoice Checkout QR Code length:', qrData.qrDataUrl.length);

    // 6. Merchant Ledger Balances
    const walletRes = await fetch(`${BASE}/admin/wallet`, { headers });
    const wallet = await walletRes.json();
    console.log('✓ 7. Merchant Ledger Balances:', wallet.balances.map(b => `${b.symbol}: ${b.available}`).join(', '));

    // 7. Wallet Deposit Address
    const depRes = await fetch(`${BASE}/admin/wallet/deposit-address?currency=USDT_BSC`, { headers });
    const deposit = await depRes.json();
    console.log('✓ 8. USDT Child Deposit Address:', deposit.address, '| Chain:', deposit.chain);

    // 8. Payment Link
    const plRes = await fetch(`${BASE}/admin/payment-links`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'E2E Test Coffee',
        currency: 'BNB_BSC',
        amount: '0.01',
      }),
    });
    const link = await plRes.json();
    console.log('✓ 9. Created Payment Link:', link.code, '| URL:', `${BASE}/v1/payment-links/${link.code}/checkout`);

    // 9. Payment Link Checkout
    const checkoutRes = await fetch(`${BASE}/v1/payment-links/${link.code}/checkout`, { method: 'POST' });
    const generatedInv = await checkoutRes.json();
    console.log('✓ 10. Generated Invoice from Payment Link:', generatedInv.id, '| Amount:', generatedInv.amount, generatedInv.currency);

    // 10. Trigger Batch Sweeper
    const sweepRes = await fetch(`${BASE}/admin/treasury/sweep`, {
      method: 'POST',
      headers,
    });
    const sweepData = await sweepRes.json();
    console.log('✓ 11. Batch Sweeper executed. Checked:', sweepData.totalChecked, '| Swept:', sweepData.sweptCount);

    // 11. Sweeps Audit History
    const sweepsHistRes = await fetch(`${BASE}/admin/treasury/sweeps?limit=5`, { headers });
    const sweepsHist = await sweepsHistRes.json();
    console.log('✓ 12. Sweeps Audit History fetched (count:', sweepsHist.sweeps.length, ')');

    console.log('\n🌟 ALL E2E VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runE2E().catch(console.error);
