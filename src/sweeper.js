import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db.js';
import { getAsset, getAllAssets } from './assets.js';
import {
  getProvider,
  getNativeBalance,
  getTokenBalance,
  derivePrivateKey,
  getCentralTreasuryAddress,
  getTreasuryPrivateKey,
  isWatchOnlyWallet,
  sendOnChainPayout,
} from './evm.js';
import { logger } from './logger.js';
import { getInvoice } from './invoices.js';
import { initTron, deriveTronAddress, getTrc20Balance } from './tron.js';
import { initBTC, deriveBtcAddress, getBtcBalance } from './btcWallet.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

/**
 * Get Live Overview of Central Treasury Wallet
 */
export async function getCentralTreasuryOverview() {
  const treasuryAddress = getCentralTreasuryAddress();
  const allAssets = getAllAssets();
  const hasHotSigner = !isWatchOnlyWallet() && !!getTreasuryPrivateKey();

  // Query live on-chain balances for Central Treasury
  const onChainBalances = await Promise.all(
    allAssets.map(async (asset) => {
      try {
        let balanceUnits = 0n;
        let chainTreasuryAddress = treasuryAddress;

        if (asset.chain === 'tron') {
          await initTron();
          chainTreasuryAddress = deriveTronAddress(0);
          balanceUnits = await getTrc20Balance(chainTreasuryAddress, asset.contract);
        } else if (asset.chain === 'btc') {
          await initBTC();
          chainTreasuryAddress = deriveBtcAddress(0, 'segwit');
          const bal = await getBtcBalance(chainTreasuryAddress);
          balanceUnits = bal.confirmedSats;
        } else if (asset.isNative) {
          balanceUnits = await getNativeBalance(treasuryAddress, asset.chain);
        } else if (asset.contract) {
          balanceUnits = await getTokenBalance(treasuryAddress, asset.contract, asset.chain);
        }
        return {
          currency: asset.currency,
          symbol: asset.symbol,
          name: asset.name,
          chain: asset.chain,
          chainId: asset.chainId,
          isNative: asset.isNative,
          decimals: asset.decimals,
          balanceUnits: balanceUnits.toString(),
          balance: ethers.formatUnits(balanceUnits, asset.decimals),
          explorerAddress: `${asset.explorerAddress}${chainTreasuryAddress}`,
          status: 'online',
        };
      } catch (err) {
        logger.warn({ err: err.message, currency: asset.currency }, 'Failed to fetch on-chain treasury balance');
        return {
          currency: asset.currency,
          symbol: asset.symbol,
          name: asset.name,
          chain: asset.chain,
          chainId: asset.chainId,
          isNative: asset.isNative,
          decimals: asset.decimals,
          balanceUnits: '0',
          balance: '0.0',
          explorerAddress: `${asset.explorerAddress}${treasuryAddress}`,
          status: 'rpc_error',
        };
      }
    })
  );

  // Query unswept confirmed invoices
  const unsweptRes = await query(
    `SELECT currency, COUNT(*) as count, SUM(CAST(amount AS REAL)) as total_amount
     FROM invoices
     WHERE status = 'confirmed' AND (sweep_status IS NULL OR sweep_status = 'unswept' OR sweep_status = 'failed')
     GROUP BY currency`
  );

  const unsweptInvoices = await query(
    `SELECT id, currency, amount, address, derivation_index, confirmed_at, sweep_status, sweep_error
     FROM invoices
     WHERE status = 'confirmed' AND (sweep_status IS NULL OR sweep_status = 'unswept' OR sweep_status = 'failed')
     ORDER BY created_at DESC LIMIT 50`
  );

  // Settings
  const coldStorageRes = await query("SELECT value FROM settings WHERE key = 'cold_storage_address'");
  const autoSweepRes = await query("SELECT value FROM settings WHERE key = 'auto_sweep_enabled'");

  return {
    treasuryAddress,
    hasHotSigner,
    isWatchOnly: isWatchOnlyWallet(),
    onChainBalances,
    unsweptSummary: unsweptRes.rows || [],
    unsweptInvoices: unsweptInvoices.rows || [],
    totalUnsweptCount: (unsweptInvoices.rows || []).length,
    coldStorageAddress: coldStorageRes.rows[0]?.value || null,
    autoSweepEnabled: autoSweepRes.rows[0]?.value !== 'false',
  };
}

/**
 * Sweeps cryptocurrency from a single invoice address into the Central Treasury Wallet
 */
export async function sweepInvoice(invoiceId, { force = false } = {}) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error(`Invoice #${invoiceId} not found`);

  if (!force && invoice.status !== 'confirmed') {
    throw new Error(`Invoice #${invoiceId} is not confirmed yet (current status: ${invoice.status})`);
  }

  if (!force && invoice.sweep_status === 'swept') {
    return {
      status: 'already_swept',
      invoiceId: invoice.id,
      sweepTxid: invoice.sweep_txid,
      sweptAmount: invoice.swept_amount,
    };
  }

  const asset = getAsset(invoice.currency);
  if (asset.chain === 'tron' || asset.chain === 'btc') {
    await query(
      "UPDATE invoices SET sweep_status = 'swept', swept_amount = $1, swept_at = datetime('now') WHERE id = $2",
      [invoice.amount, invoice.id]
    );
    logger.info({ invoiceId: invoice.id, currency: invoice.currency }, 'Non-EVM payment confirmed; settled on segregated HD child address');
    return { status: 'swept_onchain_hd', invoiceId: invoice.id, sweptAmount: invoice.amount };
  }

  if (isWatchOnlyWallet()) {
    const errorMsg = 'Cannot sweep: Server is running in watch-only mode without private keys';
    await query("UPDATE invoices SET sweep_status = 'failed', sweep_error = $1 WHERE id = $2", [errorMsg, invoice.id]);
    throw new Error(errorMsg);
  }

  const childPrivateKey = derivePrivateKey(invoice.derivation_index);
  if (!childPrivateKey) {
    const errorMsg = `No private key derivable for index ${invoice.derivation_index}`;
    await query("UPDATE invoices SET sweep_status = 'failed', sweep_error = $1 WHERE id = $2", [errorMsg, invoice.id]);
    throw new Error(errorMsg);
  }

  let destinationAddress = null;

  // 1. If invoice belongs to a merchant who configured a personal payout address:
  if (invoice.merchant_id) {
    const mRes = await query('SELECT payout_address, auto_forward FROM merchants WHERE id = $1', [invoice.merchant_id]);
    if (mRes.rows.length && mRes.rows[0].payout_address && ethers.isAddress(mRes.rows[0].payout_address)) {
      destinationAddress = ethers.getAddress(mRes.rows[0].payout_address);
      logger.info(
        { invoiceId: invoice.id, merchantId: invoice.merchant_id, destinationAddress },
        'Routing on-chain payment directly to merchant personal payout address'
      );
    }
  }

  // 2. If no merchant payout address, check if admin configured a cold storage vault:
  if (!destinationAddress) {
    const coldStorageRes = await query("SELECT value FROM settings WHERE key = 'cold_storage_address'");
    if (coldStorageRes.rows.length && coldStorageRes.rows[0].value && ethers.isAddress(coldStorageRes.rows[0].value)) {
      destinationAddress = ethers.getAddress(coldStorageRes.rows[0].value);
    }
  }

  // 3. Fallback to Central Treasury Vault address:
  if (!destinationAddress) {
    destinationAddress = getCentralTreasuryAddress();
  }

  if (invoice.address.toLowerCase() === destinationAddress.toLowerCase()) {
    // Address is already the destination address
    await query(
      "UPDATE invoices SET sweep_status = 'swept', swept_amount = $1, swept_at = datetime('now') WHERE id = $2",
      [invoice.amount, invoice.id]
    );
    return { status: 'already_at_treasury', invoiceId: invoice.id };
  }

  const provider = getProvider(asset.chain);
  const childSigner = new ethers.Wallet(childPrivateKey, provider);

  let sweepTxid = null;
  let sweptAmountFormatted = '0';
  let sweptAmountUnits = 0n;

  if (asset.isNative) {
    // 1. Native Token Sweep (BNB, ETH, MATIC)
    const balance = await provider.getBalance(invoice.address);
    if (balance === 0n) {
      await query(
        "UPDATE invoices SET sweep_status = 'swept', swept_amount = '0', swept_at = datetime('now') WHERE id = $1",
        [invoice.id]
      );
      return { status: 'zero_balance', invoiceId: invoice.id, sweptAmount: '0' };
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('3', 'gwei');
    const gasLimit = 21000n;
    const gasCost = gasLimit * gasPrice;

    if (balance <= gasCost) {
      const note = `Balance ${ethers.formatUnits(balance, asset.decimals)} is below gas fee ${ethers.formatUnits(gasCost, asset.decimals)}`;
      await query("UPDATE invoices SET sweep_status = 'dust', sweep_error = $1 WHERE id = $2", [note, invoice.id]);
      return { status: 'dust', invoiceId: invoice.id, note };
    }

    sweptAmountUnits = balance - gasCost;
    sweptAmountFormatted = ethers.formatUnits(sweptAmountUnits, asset.decimals);

    logger.info(
      { from: invoice.address, to: destinationAddress, amount: sweptAmountFormatted, chain: asset.chain },
      'Broadcasting native crypto sweep to Central Treasury'
    );

    const tx = await childSigner.sendTransaction({
      to: destinationAddress,
      value: sweptAmountUnits,
      gasLimit,
      gasPrice,
    });

    sweepTxid = tx.hash;
  } else {
    // 2. ERC-20 / BEP-20 Token Sweep (USDT)
    if (!asset.contract) throw new Error(`Missing token contract for ${invoice.currency}`);
    const tokenContract = new ethers.Contract(asset.contract, ERC20_ABI, provider);
    const tokenBal = await tokenContract.balanceOf(invoice.address);

    if (tokenBal === 0n) {
      await query(
        "UPDATE invoices SET sweep_status = 'swept', swept_amount = '0', swept_at = datetime('now') WHERE id = $1",
        [invoice.id]
      );
      return { status: 'zero_balance', invoiceId: invoice.id, sweptAmount: '0' };
    }

    // Check if child address has enough native gas to execute the token transfer
    const nativeBal = await provider.getBalance(invoice.address);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('3', 'gwei');
    const estimatedGasLimit = 65000n;
    const gasNeeded = estimatedGasLimit * gasPrice;

    if (nativeBal < gasNeeded) {
      // Sponsor gas from Treasury hot wallet
      const treasuryKey = getTreasuryPrivateKey();
      if (!treasuryKey) {
        throw new Error(`Invoice address requires native gas to sweep tokens, but no hot wallet key is configured to fund gas.`);
      }
      const treasurySigner = new ethers.Wallet(treasuryKey, provider);
      logger.info(
        { invoiceAddress: invoice.address, gasNeeded: ethers.formatEther(gasNeeded) },
        'Sponsoring gas from Treasury hot wallet to child invoice address for token sweep'
      );
      const gasTx = await treasurySigner.sendTransaction({
        to: invoice.address,
        value: (gasNeeded * 12n) / 10n, // 120% buffer
      });
      await gasTx.wait(1);
    }

    // Now execute token transfer from child signer to Central Treasury
    const tokenSigner = new ethers.Contract(asset.contract, ERC20_ABI, childSigner);
    sweptAmountUnits = tokenBal;
    sweptAmountFormatted = ethers.formatUnits(sweptAmountUnits, asset.decimals);

    logger.info(
      { from: invoice.address, to: destinationAddress, amount: sweptAmountFormatted, token: asset.symbol },
      'Broadcasting ERC-20 token sweep to Central Treasury'
    );

    const tx = await tokenSigner.transfer(destinationAddress, sweptAmountUnits, {
      gasLimit: estimatedGasLimit,
      gasPrice,
    });

    sweepTxid = tx.hash;
  }

  // Update invoice record in DB
  await query(
    `UPDATE invoices
     SET sweep_status = 'swept', sweep_txid = $1, swept_amount = $2, swept_at = datetime('now'), sweep_error = NULL
     WHERE id = $3`,
    [sweepTxid, sweptAmountFormatted, invoice.id]
  );

  // Insert into sweeps audit table
  const sweepId = uuidv4();
  await query(
    `INSERT INTO sweeps (id, invoice_id, currency, from_address, to_address, amount, amount_units, txid, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'swept', datetime('now'))`,
    [
      sweepId,
      invoice.id,
      invoice.currency,
      invoice.address,
      destinationAddress,
      sweptAmountFormatted,
      sweptAmountUnits.toString(),
      sweepTxid,
    ]
  );

  // Insert double-entry ledger audit
  await query(
    `INSERT INTO ledger (id, wallet_id, currency, amount, amount_units, type, txid, destination_address, note, created_at)
     VALUES ($1, 'default', $2, $3, $4, 'SWEEP_TO_TREASURY', $5, $6, $7, datetime('now'))`,
    [
      uuidv4(),
      invoice.currency,
      sweptAmountFormatted,
      sweptAmountUnits.toString(),
      sweepTxid,
      destinationAddress,
      `Swept invoice #${invoice.id.slice(0, 8)} to Central Treasury`,
    ]
  );

  return {
    success: true,
    status: 'swept',
    invoiceId: invoice.id,
    currency: invoice.currency,
    amount: sweptAmountFormatted,
    fromAddress: invoice.address,
    treasuryAddress: destinationAddress,
    txid: sweepTxid,
    explorerUrl: `${asset.explorerTx}${sweepTxid}`,
  };
}

/**
 * Sweeps all pending unswept confirmed invoices
 */
export async function sweepAllUnswept() {
  const unsweptRes = await query(
    `SELECT id, currency, amount, address, derivation_index
     FROM invoices
     WHERE status = 'confirmed' AND (sweep_status IS NULL OR sweep_status = 'unswept' OR sweep_status = 'failed')
     ORDER BY created_at ASC LIMIT 100`
  );

  const invoices = unsweptRes.rows || [];
  const results = [];
  const errors = [];

  for (const inv of invoices) {
    try {
      const res = await sweepInvoice(inv.id);
      results.push(res);
    } catch (err) {
      logger.error({ err: err.message, invoiceId: inv.id }, 'Error sweeping invoice');
      errors.push({ invoiceId: inv.id, error: err.message });
    }
  }

  return {
    totalChecked: invoices.length,
    sweptCount: results.filter(r => r.status === 'swept').length,
    results,
    errors,
  };
}

/**
 * Payout / Cold Storage Transfer directly from Central Treasury
 */
export async function sendTreasuryPayout({ currency, toAddress, amount, note = 'Treasury Payout' }) {
  if (!ethers.isAddress(toAddress)) {
    throw new Error(`Invalid destination address: ${toAddress}`);
  }

  const asset = getAsset(currency);
  const payout = await sendOnChainPayout({
    chain: asset.chain,
    toAddress,
    amount,
    decimals: asset.decimals,
    isNative: asset.isNative,
    tokenContract: asset.contract,
  });

  // Record in ledger
  const amountUnits = ethers.parseUnits(amount.toString(), asset.decimals).toString();
  await query(
    `INSERT INTO ledger (id, wallet_id, currency, amount, amount_units, type, txid, destination_address, note, created_at)
     VALUES ($1, 'default', $2, $3, $4, 'TREASURY_PAYOUT', $5, $6, $7, datetime('now'))`,
    [uuidv4(), currency, amount, amountUnits, payout.txid, toAddress, note]
  );

  return {
    success: true,
    txid: payout.txid,
    from: payout.from,
    to: toAddress,
    amount,
    currency,
    explorerUrl: `${asset.explorerTx}${payout.txid}`,
  };
}

/**
 * Fetch Sweeps Audit Trail
 */
export async function getSweepsHistory(limit = 50) {
  const res = await query('SELECT * FROM sweeps ORDER BY created_at DESC LIMIT $1', [limit]);
  return res.rows || [];
}
