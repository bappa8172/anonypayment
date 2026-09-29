// src/btcWallet.js — Bitcoin (BTC) HD Wallet & Mempool Engine
// BIP-84 Native SegWit (bc1q...) and BIP-44 Legacy derivation with live Mempool.space integration

import { ethers } from 'ethers';
import crypto from 'crypto';
import { bech32 } from 'bech32';
import { config } from './config.js';
import { logger } from './logger.js';
import { query } from './db.js';
import { base58CheckEncode } from './tron.js';

let btcHdRoot = null;
let btcLegacyHdRoot = null;

/**
 * Initialize BTC HD derivation roots from unified gateway mnemonic
 */
export async function initBTC() {
  if (btcHdRoot) return true;

  try {
    let mnemonic = config.evm?.mnemonic;

    if (!mnemonic) {
      const settingRes = await query("SELECT value FROM settings WHERE key = 'master_hd_mnemonic'");
      if (settingRes.rows.length) {
        mnemonic = settingRes.rows[0].value;
      }
    }

    if (!mnemonic) {
      const randomWallet = ethers.Wallet.createRandom();
      mnemonic = randomWallet.mnemonic.phrase;
      await query(
        `INSERT INTO settings (key, value) VALUES ('master_hd_mnemonic', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [mnemonic]
      );
      logger.info('Generated new HD Master mnemonic for crypto gateway');
    }

    // BIP-84 Native SegWit path: m/84'/0'/0'/0
    btcHdRoot = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/84'/0'/0'/0");
    // BIP-44 Legacy path: m/44'/0'/0'/0
    btcLegacyHdRoot = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/0'/0'/0");

    const segwitChild0 = deriveBtcAddress(0, 'segwit');
    logger.info({ btcRootSegwit: segwitChild0 }, 'Bitcoin (BTC) HD Wallet engine initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to initialize BTC HD Wallet');
    return false;
  }
}

/**
 * Derive Bitcoin address from child derivation index
 * @param {number} index
 * @param {'segwit'|'legacy'} type
 */
export function deriveBtcAddress(index, type = 'segwit') {
  if (type === 'legacy') {
    if (!btcLegacyHdRoot) throw new Error('BTC HD Wallet not initialized');
    const child = btcLegacyHdRoot.deriveChild(index);
    const compPub = Buffer.from(ethers.SigningKey.computePublicKey(child.privateKey, true).slice(2), 'hex');
    const sha = crypto.createHash('sha256').update(compPub).digest();
    const ripe = crypto.createHash('ripemd160').update(sha).digest();
    const payload = Buffer.concat([Buffer.from([0x00]), ripe]); // 0x00 = Bitcoin mainnet P2PKH prefix
    return base58CheckEncode(payload);
  }

  // Native SegWit (BIP-84, P2WPKH, bc1q...)
  if (!btcHdRoot) throw new Error('BTC HD Wallet not initialized');
  const child = btcHdRoot.deriveChild(index);
  const compPub = Buffer.from(ethers.SigningKey.computePublicKey(child.privateKey, true).slice(2), 'hex');
  const sha = crypto.createHash('sha256').update(compPub).digest();
  const ripe = crypto.createHash('ripemd160').update(sha).digest();
  const words = bech32.toWords(ripe);
  words.unshift(0); // witness version 0
  return bech32.encode('bc', words);
}

/**
 * Derive BTC child private key in hex
 */
export function deriveBtcPrivateKey(index, type = 'segwit') {
  const root = type === 'legacy' ? btcLegacyHdRoot : btcHdRoot;
  if (!root) throw new Error('BTC HD Wallet not initialized');
  const child = root.deriveChild(index);
  return child.privateKey;
}

/**
 * Validate Bitcoin address (Native SegWit, P2SH, or Legacy)
 */
export function isBtcAddress(address) {
  if (!address || typeof address !== 'string') return false;

  // Native SegWit (Bech32 bc1q...)
  if (address.startsWith('bc1q')) {
    try {
      const decoded = bech32.decode(address);
      return decoded.prefix === 'bc' && decoded.words.length === 33 && decoded.words[0] === 0;
    } catch {
      return false;
    }
  }

  // Legacy (1...) or P2SH (3...)
  if (address.startsWith('1') || address.startsWith('3')) {
    if (address.length < 26 || address.length > 35) return false;
    try {
      const decoded = Buffer.from(address); // Basic sanity check
      return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Query current block tip height from Mempool API (or Blockstream fallback)
 */
export async function getBtcTipHeight() {
  const apiUrl = config.btc?.apiUrl || 'https://mempool.space/api';
  try {
    const res = await fetch(`${apiUrl}/blocks/tip/height`, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const text = await res.text();
      return parseInt(text.trim(), 10);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Mempool.space block tip height failed, attempting fallback');
  }

  try {
    const res = await fetch('https://blockstream.info/api/blocks/tip/height', { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const text = await res.text();
      return parseInt(text.trim(), 10);
    }
  } catch (fallbackErr) {
    logger.warn({ err: fallbackErr.message }, 'Blockstream block tip height failed');
  }

  return 0;
}

/**
 * Query transactions for a Bitcoin address from Mempool API
 */
export async function getBtcTransactions(address) {
  const apiUrl = config.btc?.apiUrl || 'https://mempool.space/api';
  try {
    const res = await fetch(`${apiUrl}/address/${address}/txs`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const txs = await res.json();
      if (Array.isArray(txs)) return txs;
    }
  } catch (err) {
    logger.warn({ err: err.message, address }, 'Mempool.space txs query failed, trying Blockstream');
  }

  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}/txs`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const txs = await res.json();
      if (Array.isArray(txs)) return txs;
    }
  } catch {}

  return [];
}

/**
 * Query UTXOs for a Bitcoin address
 */
export async function getBtcUtxos(address) {
  const apiUrl = config.btc?.apiUrl || 'https://mempool.space/api';
  try {
    const res = await fetch(`${apiUrl}/address/${address}/utxo`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const utxos = await res.json();
      if (Array.isArray(utxos)) return utxos;
    }
  } catch {}

  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}/utxo`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const utxos = await res.json();
      if (Array.isArray(utxos)) return utxos;
    }
  } catch {}

  return [];
}

/**
 * Query confirmed and unconfirmed balance for a Bitcoin address in Satoshis
 */
export async function getBtcBalance(address) {
  const apiUrl = config.btc?.apiUrl || 'https://mempool.space/api';
  try {
    const res = await fetch(`${apiUrl}/address/${address}`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const data = await res.json();
      const funded = BigInt(data?.chain_stats?.funded_txo_sum || 0);
      const spent = BigInt(data?.chain_stats?.spent_txo_sum || 0);
      const confirmedSats = funded >= spent ? funded - spent : 0n;

      const mempoolFunded = BigInt(data?.mempool_stats?.funded_txo_sum || 0);
      const mempoolSpent = BigInt(data?.mempool_stats?.spent_txo_sum || 0);
      const mempoolSats = mempoolFunded >= mempoolSpent ? mempoolFunded - mempoolSpent : 0n;

      return {
        confirmedSats,
        mempoolSats,
        totalSats: confirmedSats + mempoolSats,
      };
    }
  } catch (err) {
    logger.warn({ err: err.message, address }, 'Failed to fetch BTC address balance');
  }

  return { confirmedSats: 0n, mempoolSats: 0n, totalSats: 0n };
}
