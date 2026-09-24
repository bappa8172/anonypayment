import express from 'express';
import { z } from 'zod';
import { requireAdminApiKey } from './security.js';
import {
  getWalletBalances,
  getWalletDepositAddress,
  withdrawCrypto,
  transferInternal,
  getLedgerHistory,
  getOrCreateWallet,
} from './wallet.js';
import { createPaymentLink, listPaymentLinks, getGatewayStats } from './invoices.js';
import { getBlockNumber, getProvider, getCentralTreasuryAddress, getTreasuryPrivateKey } from './evm.js';
import { config } from './config.js';
import { getAllAssets } from './assets.js';
import QRCode from 'qrcode';
import { query } from './db.js';
import {
  getCentralTreasuryOverview,
  sweepInvoice,
  sweepAllUnswept,
  sendTreasuryPayout,
  getSweepsHistory,
} from './sweeper.js';

const router = express.Router();
router.use(requireAdminApiKey);

const withdrawSchema = z.object({
  currency: z.string(),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM 0x address'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
  note: z.string().optional(),
});

const transferSchema = z.object({
  toWalletId: z.string().min(1),
  currency: z.string(),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
  note: z.string().optional(),
});

const paymentLinkSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  currency: z.string().default('BNB_BSC'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  redirectUrl: z.string().url().optional().or(z.literal('')),
});

// 1. Get Wallet Balances
router.get('/wallet', async (req, res) => {
  try {
    const walletId = req.query.walletId || 'default';
    const balances = await getWalletBalances(walletId);
    res.json({ walletId, balances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Deposit Address + QR code
router.get('/wallet/deposit-address', async (req, res) => {
  try {
    const walletId = req.query.walletId || 'default';
    const currency = req.query.currency || 'BNB_BSC';
    const deposit = await getWalletDepositAddress(walletId, currency);
    res.json(deposit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Real On-chain Withdrawal / Payout
router.post('/wallet/withdraw', async (req, res) => {
  try {
    const data = withdrawSchema.parse(req.body);
    const result = await withdrawCrypto({
      walletId: req.body.walletId || 'default',
      currency: data.currency,
      toAddress: data.toAddress,
      amount: data.amount,
      note: data.note,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Instant Internal Transfer
router.post('/wallet/transfer', async (req, res) => {
  try {
    const data = transferSchema.parse(req.body);
    const result = await transferInternal({
      fromWalletId: req.body.fromWalletId || 'default',
      toWalletId: data.toWalletId,
      currency: data.currency,
      amount: data.amount,
      note: data.note,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Ledger / History
router.get('/wallet/ledger', async (req, res) => {
  try {
    const walletId = req.query.walletId || 'default';
    const limit = parseInt(req.query.limit || '50', 10);
    const history = await getLedgerHistory(walletId, limit);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Gateway Stats Overview
router.get('/stats', async (req, res) => {
  try {
    const stats = await getGatewayStats();
    const balances = await getWalletBalances('default');
    res.json({
      stats,
      balances,
      networkMode: config.networkMode,
      activeChainId: config.evm.chainId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Payment Links
router.post('/payment-links', async (req, res) => {
  try {
    const data = paymentLinkSchema.parse(req.body);
    const link = await createPaymentLink(data);
    res.json(link);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/payment-links', async (req, res) => {
  try {
    const links = await listPaymentLinks();
    res.json({ links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Network and RPC Status
router.get('/network-status', async (req, res) => {
  try {
    const bscBlock = await getBlockNumber('bsc');
    const provider = getProvider('bsc');
    const feeData = await provider.getFeeData();

    res.json({
      networkMode: config.networkMode,
      bsc: {
        chainId: config.evm.chainId,
        blockNumber: bscBlock,
        gasPriceGwei: feeData.gasPrice ? Number(feeData.gasPrice) / 1e9 : null,
      },
      supportedAssets: getAllAssets(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Central Treasury Overview
router.get('/treasury', async (req, res) => {
  try {
    const overview = await getCentralTreasuryOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Central Treasury QR Code for Direct Deposits
router.get('/treasury/qr', async (req, res) => {
  try {
    const address = getCentralTreasuryAddress();
    const qrDataUrl = await QRCode.toDataURL(address, { margin: 1, width: 280 });
    res.json({ address, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Sweep Single Invoice to Central Treasury
router.post('/treasury/sweep/:id', async (req, res) => {
  try {
    const result = await sweepInvoice(req.params.id, { force: req.body?.force === true });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 12. Batch Sweep All Unswept Invoices
router.post('/treasury/sweep', async (req, res) => {
  try {
    const result = await sweepAllUnswept();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Direct Central Treasury Payout / Cold Storage Transfer
const treasuryPayoutSchema = z.object({
  currency: z.string(),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM 0x address'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
  note: z.string().optional(),
});

router.post('/treasury/payout', async (req, res) => {
  try {
    const data = treasuryPayoutSchema.parse(req.body);
    const result = await sendTreasuryPayout(data);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 14. Sweeps Audit History
router.get('/treasury/sweeps', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const history = await getSweepsHistory(limit);
    res.json({ sweeps: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Update Treasury Settings
const treasurySettingsSchema = z.object({
  coldStorageAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().or(z.literal('')),
  autoSweepEnabled: z.boolean().optional(),
});

router.post('/treasury/settings', async (req, res) => {
  try {
    const data = treasurySettingsSchema.parse(req.body);
    if (data.coldStorageAddress !== undefined) {
      await query(
        `INSERT INTO settings (key, value) VALUES ('cold_storage_address', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [data.coldStorageAddress]
      );
    }
    if (data.autoSweepEnabled !== undefined) {
      await query(
        `INSERT INTO settings (key, value) VALUES ('auto_sweep_enabled', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [data.autoSweepEnabled ? 'true' : 'false']
      );
    }
    res.json({ success: true, message: 'Treasury settings updated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 16. Secure Backup (Mnemonic & Central Treasury Key)
router.get('/wallet/backup', async (req, res) => {
  try {
    const settingRes = await query("SELECT value FROM settings WHERE key = 'master_hd_mnemonic'");
    const mnemonic = settingRes.rows.length ? settingRes.rows[0].value : (config.evm.mnemonic || null);
    const treasuryAddress = getCentralTreasuryAddress();
    const treasuryPrivateKey = getTreasuryPrivateKey();

    res.json({
      treasuryAddress,
      mnemonic,
      treasuryPrivateKey,
      derivationPath: "m/44'/60'/0'/0",
      warning: "Keep this recovery phrase safe. Importing it into Trust Wallet or MetaMask restores full access to all your funds.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
