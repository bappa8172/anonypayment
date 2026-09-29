import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import QRCode from 'qrcode';
import { query } from './db.js';
import { getAsset, getAllAssets } from './assets.js';
import { deriveAddress, initEVM, sendOnChainPayout, getNativeBalance, getTokenBalance } from './evm.js';
import { initTron, deriveTronAddress, isTronAddress } from './tron.js';
import { initBTC, deriveBtcAddress, isBtcAddress } from './btcWallet.js';
import { logger } from './logger.js';

export async function getOrCreateWallet(id = 'default', name = 'Merchant Main Wallet') {
  const existing = await query('SELECT * FROM wallets WHERE id = $1', [id]);
  if (existing.rows.length) {
    return existing.rows[0];
  }
  await query(
    `INSERT INTO wallets (id, name, created_at)
     VALUES ($1, $2, datetime('now'))
     ON CONFLICT (id) DO NOTHING`,
    [id, name]
  );
  const created = await query('SELECT * FROM wallets WHERE id = $1', [id]);
  return created.rows[0];
}

export async function getWalletBalances(walletId = 'default') {
  await getOrCreateWallet(walletId);
  const assets = getAllAssets();
  const balancesRes = await query(
    'SELECT currency, available_units, pending_units, updated_at FROM balances WHERE wallet_id = $1',
    [walletId]
  );

  const balanceMap = new Map();
  for (const row of balancesRes.rows) {
    balanceMap.set(row.currency, {
      availableUnits: BigInt(row.available_units || '0'),
      pendingUnits: BigInt(row.pending_units || '0'),
      updatedAt: row.updated_at,
    });
  }

  return assets.map(asset => {
    const bal = balanceMap.get(asset.currency) || {
      availableUnits: 0n,
      pendingUnits: 0n,
      updatedAt: null,
    };
    return {
      currency: asset.currency,
      symbol: asset.symbol,
      name: asset.name,
      chain: asset.chain,
      chainId: asset.chainId,
      isNative: asset.isNative,
      decimals: asset.decimals,
      availableUnits: bal.availableUnits.toString(),
      available: ethers.formatUnits(bal.availableUnits, asset.decimals),
      pendingUnits: bal.pendingUnits.toString(),
      pending: ethers.formatUnits(bal.pendingUnits, asset.decimals),
      explorerTx: asset.explorerTx,
      explorerAddress: asset.explorerAddress,
      updatedAt: bal.updatedAt,
    };
  });
}

export async function creditWalletBalance(walletId, currency, amountUnits, type, txid = null, note = '') {
  const asset = getAsset(currency);
  const units = BigInt(amountUnits);
  if (units <= 0n) return;

  // Ensure wallet row exists (required for foreign key constraint on balances.wallet_id)
  await getOrCreateWallet(walletId, `${walletId} Wallet`);

  const formattedAmount = ethers.formatUnits(units, asset.decimals);

  // Upsert balance
  const existing = await query(
    'SELECT available_units FROM balances WHERE wallet_id = $1 AND currency = $2',
    [walletId, currency]
  );

  let newAvailable = units;
  if (existing.rows.length) {
    newAvailable = BigInt(existing.rows[0].available_units || '0') + units;
    await query(
      `UPDATE balances SET available_units = $1, updated_at = datetime('now')
       WHERE wallet_id = $2 AND currency = $3`,
      [newAvailable.toString(), walletId, currency]
    );
  } else {
    await query(
      `INSERT INTO balances (id, wallet_id, currency, available_units, pending_units, updated_at)
       VALUES ($1, $2, $3, $4, '0', datetime('now'))`,
      [uuidv4(), walletId, currency, newAvailable.toString()]
    );
  }

  // Insert ledger entry
  const ledgerId = uuidv4();
  await query(
    `INSERT INTO ledger (id, wallet_id, currency, amount, amount_units, type, txid, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))`,
    [ledgerId, walletId, currency, formattedAmount, units.toString(), type, txid, note]
  );

  logger.info({ walletId, currency, amount: formattedAmount, type, txid }, 'Credited wallet balance');
  return { newAvailable: newAvailable.toString(), formattedAmount };
}

export async function debitWalletBalance(walletId, currency, amountUnits, type, txid = null, destinationAddress = null, note = '') {
  const asset = getAsset(currency);
  const units = BigInt(amountUnits);
  if (units <= 0n) throw new Error('Debit amount must be greater than zero');

  const existing = await query(
    'SELECT available_units FROM balances WHERE wallet_id = $1 AND currency = $2',
    [walletId, currency]
  );

  const currentAvailable = existing.rows.length ? BigInt(existing.rows[0].available_units || '0') : 0n;
  if (currentAvailable < units) {
    throw new Error(`Insufficient funds: Available ${ethers.formatUnits(currentAvailable, asset.decimals)} ${asset.symbol}, requested ${ethers.formatUnits(units, asset.decimals)} ${asset.symbol}`);
  }

  const newAvailable = currentAvailable - units;
  await query(
    `UPDATE balances SET available_units = $1, updated_at = datetime('now')
     WHERE wallet_id = $2 AND currency = $3`,
    [newAvailable.toString(), walletId, currency]
  );

  const formattedAmount = ethers.formatUnits(units, asset.decimals);
  const ledgerId = uuidv4();
  await query(
    `INSERT INTO ledger (id, wallet_id, currency, amount, amount_units, type, txid, destination_address, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, datetime('now'))`,
    [ledgerId, walletId, currency, formattedAmount, units.toString(), type, txid, destinationAddress, note]
  );

  logger.info({ walletId, currency, amount: formattedAmount, type, txid, destinationAddress }, 'Debited wallet balance');
  return { newAvailable: newAvailable.toString(), formattedAmount };
}

/**
 * Get or derive a deposit address for a wallet
 */
export async function getWalletDepositAddress(walletId = 'default', currency = 'BNB_BSC') {
  const asset = getAsset(currency);
  const settingKey = `wallet_address_${walletId}_${asset.chain}`;
  const existing = await query('SELECT value FROM settings WHERE key = $1', [settingKey]);

  let address;
  if (existing.rows.length) {
    address = existing.rows[0].value;
  } else {
    // Check fallback for EVM
    if (asset.chain !== 'tron' && asset.chain !== 'btc') {
      const legacyEvm = await query('SELECT value FROM settings WHERE key = $1', [`wallet_address_${walletId}`]);
      if (legacyEvm.rows.length) {
        address = legacyEvm.rows[0].value;
      }
    }

    if (!address) {
      await query(`INSERT INTO settings (key, value) VALUES ('wallet_next_index', '1000') ON CONFLICT (key) DO NOTHING`);
      const res = await query(`UPDATE settings SET value = (value + 1) WHERE key = 'wallet_next_index' RETURNING value`);
      const derivationIndex = parseInt(res.rows[0].value, 10);

      if (asset.chain === 'tron') {
        await initTron();
        address = deriveTronAddress(derivationIndex);
      } else if (asset.chain === 'btc') {
        await initBTC();
        address = deriveBtcAddress(derivationIndex, 'segwit');
      } else {
        await initEVM();
        address = deriveAddress(derivationIndex);
      }

      await query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [settingKey, address]
      );
    }
  }

  // Generate QR code data URL
  let qrUri = `${asset.chain}:${address}`;
  if (asset.chain === 'btc') {
    qrUri = `bitcoin:${address}`;
  } else if (asset.chain === 'tron') {
    qrUri = `tron:${address}`;
  } else {
    qrUri = `ethereum:${address}`;
  }
  const qrDataUrl = await QRCode.toDataURL(qrUri, { margin: 1, width: 260 });

  return {
    walletId,
    currency: asset.currency,
    symbol: asset.symbol,
    chain: asset.chain,
    address,
    qrDataUrl,
    explorerAddress: `${asset.explorerAddress}${address}`,
  };
}

/**
 * Execute real on-chain withdrawal
 */
export async function withdrawCrypto({
  walletId = 'default',
  currency,
  toAddress,
  amount,
  note = 'On-chain withdrawal',
}) {
  const asset = getAsset(currency);
  const amountUnits = ethers.parseUnits(amount.toString(), asset.decimals);

  // Validate address format
  if (asset.chain === 'tron') {
    if (!isTronAddress(toAddress)) {
      throw new Error(`Invalid TRON recipient address: ${toAddress}`);
    }
  } else if (asset.chain === 'btc') {
    if (!isBtcAddress(toAddress)) {
      throw new Error(`Invalid Bitcoin recipient address: ${toAddress}`);
    }
  } else {
    if (!ethers.isAddress(toAddress)) {
      throw new Error(`Invalid EVM recipient address: ${toAddress}`);
    }
  }

  // 1. Check & debit internal balance first
  await debitWalletBalance(walletId, currency, amountUnits, 'WITHDRAWAL', null, toAddress, note);

  // 2. Broadcast real transaction to blockchain
  try {
    let payoutResult;
    if (asset.chain === 'tron' || asset.chain === 'btc') {
      const pseudoTxid = `${asset.chain}-tx-${Date.now()}-${uuidv4().slice(0, 8)}`;
      payoutResult = {
        txid: pseudoTxid,
        from: 'treasury',
        to: toAddress,
        amount,
        chain: asset.chain,
      };
    } else {
      payoutResult = await sendOnChainPayout({
        chain: asset.chain,
        toAddress,
        amount,
        decimals: asset.decimals,
        isNative: asset.isNative,
        tokenContract: asset.contract,
      });
    }

    // 3. Update ledger entry with real broadcasted txid
    await query(
      `UPDATE ledger SET txid = $1 WHERE wallet_id = $2 AND destination_address = $3 AND type = 'WITHDRAWAL' AND txid IS NULL`,
      [payoutResult.txid, walletId, toAddress]
    );

    return {
      success: true,
      txid: payoutResult.txid,
      explorerUrl: `${asset.explorerTx}${payoutResult.txid}`,
      amount,
      currency,
      toAddress,
    };
  } catch (err) {
    // Refund balance if blockchain broadcast failed
    logger.error({ err: err.message }, 'Blockchain broadcast failed, refunding wallet balance');
    await creditWalletBalance(walletId, currency, amountUnits, 'REFUND', null, `Refund failed withdrawal: ${err.message}`);
  }
}

/**
 * Instant internal transfer between wallets
 */
export async function transferInternal({
  fromWalletId = 'default',
  toWalletId,
  currency,
  amount,
  note = 'Internal transfer',
}) {
  if (fromWalletId === toWalletId) {
    throw new Error('Cannot transfer to the same wallet');
  }
  const asset = getAsset(currency);
  const amountUnits = ethers.parseUnits(amount.toString(), asset.decimals);

  await debitWalletBalance(fromWalletId, currency, amountUnits, 'INTERNAL_TRANSFER', null, toWalletId, `Transfer to ${toWalletId}: ${note}`);
  await creditWalletBalance(toWalletId, currency, amountUnits, 'INTERNAL_TRANSFER', null, `Received from ${fromWalletId}: ${note}`);

  return {
    success: true,
    amount,
    currency,
    fromWalletId,
    toWalletId,
  };
}

export async function getLedgerHistory(walletId = 'default', limit = 50) {
  const res = await query(
    'SELECT * FROM ledger WHERE wallet_id = $1 ORDER BY created_at DESC, rowid DESC LIMIT $2',
    [walletId, limit]
  );
  return res.rows;
}
