import express from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from './security.js';
import {
  getWalletBalances,
  getWalletDepositAddress,
  withdrawCrypto,
  transferInternal,
  getLedgerHistory,
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
import { listAllMerchants, setMerchantStatus } from './auth.js';

const router = express.Router();
router.use(authenticate);

const withdrawSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object') {
      const obj = { ...val };
      if (!obj.toAddress && obj.address) {
        obj.toAddress = obj.address;
      }
      if (typeof obj.toAddress === 'string') {
        obj.toAddress = obj.toAddress.trim();
      }
      return obj;
    }
    return val;
  },
  z.object({
    currency: z.string(),
    toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM 0x address'),
    amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
    note: z.string().optional(),
  })
);

const transferSchema = z.object({
  toWalletId: z.string().min(1, 'Target wallet ID is required'),
  currency: z.string(),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
  note: z.string().optional(),
});

const paymentLinkSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  currency: z.string().default('BNB_BSC'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
  redirectUrl: z.string().url().optional().or(z.literal('')),
});

// Helper to determine wallet ID with strict merchant isolation
function resolveWalletId(req) {
  if (req.user?.walletId && req.user.walletId !== 'default') {
    return req.user.walletId;
  }
  return req.query?.walletId || req.body?.walletId || req.user?.walletId || 'default';
}

// 1. Get Wallet Balances (Scoped to Merchant or requested by Admin)
router.get('/wallet', async (req, res, next) => {
  try {
    const walletId = resolveWalletId(req);
    const balances = await getWalletBalances(walletId);
    res.json({ walletId, balances });
  } catch (err) {
    next(err);
  }
});

// 2. Get Deposit Address + QR code (Scoped to Merchant or requested by Admin)
router.get('/wallet/deposit-address', async (req, res, next) => {
  try {
    const walletId = resolveWalletId(req);
    const currency = req.query.currency || 'BNB_BSC';
    const deposit = await getWalletDepositAddress(walletId, currency);
    res.json(deposit);
  } catch (err) {
    next(err);
  }
});

// 3. Real On-chain Withdrawal / Payout (Debits merchant's own balance)
router.post('/wallet/withdraw', async (req, res, next) => {
  try {
    const data = withdrawSchema.parse(req.body);
    const walletId = resolveWalletId(req);
    const result = await withdrawCrypto({
      walletId,
      currency: data.currency,
      toAddress: data.toAddress,
      amount: data.amount,
      note: data.note,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 4. Instant Internal Transfer
router.post('/wallet/transfer', async (req, res, next) => {
  try {
    const data = transferSchema.parse(req.body);
    const fromWalletId = resolveWalletId(req);
    const result = await transferInternal({
      fromWalletId,
      toWalletId: data.toWalletId,
      currency: data.currency,
      amount: data.amount,
      note: data.note,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 5. Get Ledger History (Strictly scoped to merchant's own transactions)
router.get('/wallet/ledger', async (req, res, next) => {
  try {
    const walletId = resolveWalletId(req);
    const limit = parseInt(req.query.limit || '50', 10);
    const history = await getLedgerHistory(walletId, limit);
    res.json({ walletId, history });
  } catch (err) {
    next(err);
  }
});

// 6. Create Payment Link (Tagged with merchant identity)
router.post('/payment-links', async (req, res, next) => {
  try {
    const data = paymentLinkSchema.parse(req.body);
    const merchantId = (req.user && req.user.id !== 'admin') ? req.user.id : (req.body?.merchantId || req.user?.id || null);
    const walletId = resolveWalletId(req);

    const link = await createPaymentLink({
      ...data,
      merchantId,
      walletId,
    });
    res.json(link);
  } catch (err) {
    next(err);
  }
});

// 7. List Payment Links (Scoped to merchant)
router.get('/payment-links', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const merchantId = (req.user && req.user.id !== 'admin') ? req.user.id : (req.query.merchantId || null);
    const links = await listPaymentLinks({ limit, merchantId });
    res.json({ links });
  } catch (err) {
    next(err);
  }
});

// 8. Stats for Dashboard Overview (Scoped to merchant or global for Admin)
router.get('/stats', async (req, res, next) => {
  try {
    const merchantId = (req.user && req.user.id !== 'admin') ? req.user.id : (req.query.merchantId || null);
    const walletId = resolveWalletId(req);
    const stats = await getGatewayStats(merchantId);
    const balances = await getWalletBalances(walletId);

    res.json({
      stats,
      balances,
      networkMode: config.networkMode,
      activeChainId: config.evm.chainId,
    });
  } catch (err) {
    next(err);
  }
});

// 9. Network Status & RPC Info
router.get('/network-status', async (req, res, next) => {
  try {
    const blockNumber = await getBlockNumber();
    const provider = getProvider();
    const feeData = await provider.getFeeData();
    const gasPriceGwei = feeData.gasPrice ? Number(feeData.gasPrice) / 1e9 : 0;

    res.json({
      networkMode: config.networkMode,
      bsc: {
        chainId: config.evm.chainId,
        blockNumber,
        gasPriceGwei: parseFloat(gasPriceGwei.toFixed(4)),
      },
      supportedAssets: getAllAssets(),
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// SUPER ADMIN ONLY ROUTES (Central Treasury, Global Sweeps, Master Backup)
// Merchants are strictly blocked with 403 Forbidden
// =========================================================================

// 10. Central Treasury Master Overview
router.get('/treasury', requireAdmin, async (req, res, next) => {
  try {
    const overview = await getCentralTreasuryOverview();
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

// 11. Central Treasury Direct QR Code
router.get('/treasury/qr', requireAdmin, async (req, res, next) => {
  try {
    const address = getCentralTreasuryAddress();
    const qrDataUrl = await QRCode.toDataURL(address, { margin: 1, width: 280 });
    res.json({ address, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

// 12. Sweep Single Invoice to Central Treasury
router.post('/treasury/sweep/:id', requireAdmin, async (req, res, next) => {
  try {
    const result = await sweepInvoice(req.params.id, { force: req.body?.force === true });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 13. Batch Sweep All Unswept Invoices
router.post('/treasury/sweep', requireAdmin, async (req, res, next) => {
  try {
    const result = await sweepAllUnswept();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 14. Direct Central Treasury Payout / Cold Storage Transfer
const treasuryPayoutSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object') {
      const obj = { ...val };
      if (!obj.toAddress && obj.address) {
        obj.toAddress = obj.address;
      }
      if (typeof obj.toAddress === 'string') {
        obj.toAddress = obj.toAddress.trim();
      }
      return obj;
    }
    return val;
  },
  z.object({
    currency: z.string(),
    toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM 0x address'),
    amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
    note: z.string().optional(),
  })
);

router.post('/treasury/payout', requireAdmin, async (req, res, next) => {
  try {
    const data = treasuryPayoutSchema.parse(req.body);
    const result = await sendTreasuryPayout(data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 15. Sweeps Audit History
router.get('/treasury/sweeps', requireAdmin, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const history = await getSweepsHistory(limit);
    res.json({ sweeps: history });
  } catch (err) {
    next(err);
  }
});

// 16. Update Treasury Settings
const treasurySettingsSchema = z.object({
  coldStorageAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM 0x address').optional().or(z.literal('')),
  autoSweepEnabled: z.boolean().optional(),
});

router.post('/treasury/settings', requireAdmin, async (req, res, next) => {
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
    next(err);
  }
});

// 17. Master Security Backup (Mnemonic & Central Treasury Key) - STRICTLY SUPER ADMIN ONLY
router.get('/wallet/backup', requireAdmin, async (req, res, next) => {
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
      warning: 'Keep this recovery phrase safe. Importing it into Trust Wallet or MetaMask restores full access to all central treasury funds.',
    });
  } catch (err) {
    next(err);
  }
});

// 18. Admin: List All Merchants
router.get('/merchants', requireAdmin, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const merchants = await listAllMerchants({ limit, offset });
    res.json({ merchants });
  } catch (err) {
    next(err);
  }
});

// 19. Admin: Suspend or Activate Merchant
router.post('/merchants/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
    const updated = await setMerchantStatus(req.params.id, status);
    res.json({ success: true, merchant: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
