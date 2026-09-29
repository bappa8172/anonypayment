// src/tron.js — TRON Network & USDT (TRC-20) Engine
// Fully standard BIP-44 key derivation (m/44'/195'/0'/0/i) and TronGrid/TronScan integration

import { ethers } from 'ethers';
import crypto from 'crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { query } from './db.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58 encoding helper
 */
export function base58Encode(buf) {
  let num = BigInt('0x' + buf.toString('hex'));
  let str = '';
  while (num > 0n) {
    const rem = num % 58n;
    num = num / 58n;
    str = ALPHABET[Number(rem)] + str;
  }
  for (let i = 0; i < buf.length && buf[i] === 0; i++) {
    str = '1' + str;
  }
  return str;
}

/**
 * Base58 decoding helper
 */
export function base58Decode(str) {
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base58 character: ${char}`);
    num = num * 58n + BigInt(index);
  }
  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const bytes = Buffer.from(hex, 'hex');

  let leadingZeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    leadingZeros++;
  }
  return Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
}

/**
 * Base58Check encode with double SHA-256 checksum
 */
export function base58CheckEncode(payload) {
  const hash1 = crypto.createHash('sha256').update(payload).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  const checksum = hash2.slice(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

/**
 * Validate Base58Check string
 */
export function isTronAddress(address) {
  if (!address || typeof address !== 'string' || address.length !== 34 || !address.startsWith('T')) {
    return false;
  }
  try {
    const decoded = base58Decode(address);
    if (decoded.length !== 25) return false;
    const payload = decoded.slice(0, 21);
    const checksum = decoded.slice(21);
    if (payload[0] !== 0x41) return false;
    const hash1 = crypto.createHash('sha256').update(payload).digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    return hash2.slice(0, 4).equals(checksum);
  } catch {
    return false;
  }
}

let tronHdRoot = null;

/**
 * Initialize TRON HD derivation root from unified gateway mnemonic
 */
export async function initTron() {
  if (tronHdRoot) return true;

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

    // Standard TRON BIP-44 path: m/44'/195'/0'/0
    tronHdRoot = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/195'/0'/0");
    const child0 = deriveTronAddress(0);
    logger.info({ tronRootAddress: child0 }, 'TRON (TRC-20) HD Wallet engine initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to initialize TRON HD Wallet');
    return false;
  }
}

/**
 * Derive TRON Base58Check address starting with 'T' from child index
 */
export function deriveTronAddress(index) {
  if (!tronHdRoot) throw new Error('TRON HD Wallet not initialized');
  const child = tronHdRoot.deriveChild(index);

  // Compute uncompressed public key (65 bytes: 0x04 + 64 bytes)
  const uncompressedPub = ethers.SigningKey.computePublicKey(child.privateKey, false);
  const pubBytes = Buffer.from(uncompressedPub.slice(4), 'hex'); // discard leading 0x04 prefix
  const keccak = ethers.keccak256(pubBytes);
  // TRON address prefix byte: 0x41 followed by the last 20 bytes of keccak256
  const tronPayload = Buffer.concat([Buffer.from([0x41]), Buffer.from(keccak.slice(26), 'hex')]);
  return base58CheckEncode(tronPayload);
}

/**
 * Derive TRON child private key in hex
 */
export function deriveTronPrivateKey(index) {
  if (!tronHdRoot) throw new Error('TRON HD Wallet not initialized');
  const child = tronHdRoot.deriveChild(index);
  return child.privateKey;
}

/**
 * Query current block number on TRON
 */
export async function getTronBlockNumber() {
  const tronApiUrl = config.tron?.apiUrl || 'https://api.trongrid.io';
  try {
    const res = await fetch(`${tronApiUrl}/wallet/getnowblock`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.block_header?.raw_data?.number || 0;
  } catch (err) {
    // Fallback to TronScan public API
    try {
      const res = await fetch('https://apilist.tronscanapi.com/api/block/latest', { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      return data?.number || 0;
    } catch {
      logger.warn({ err: err.message }, 'Failed to fetch TRON block height');
      return 0;
    }
  }
}

/**
 * Query incoming TRC-20 transactions for a given TRON address
 */
export async function getTrc20Transactions(address, contractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') {
  const tronApiUrl = config.tron?.apiUrl || 'https://api.trongrid.io';
  const url = `${tronApiUrl}/v1/accounts/${address}/transactions/trc20?contract_address=${contractAddress}&limit=20`;

  try {
    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.data)) {
        return json.data;
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, address }, 'TronGrid TRC20 fetch failed, attempting fallback');
  }

  // Fallback to TronScan public API
  try {
    const fallbackUrl = `https://apilist.tronscanapi.com/api/new/transfer/record?address=${address}&contract_address=${contractAddress}&direction=in&limit=20`;
    const res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.data)) {
        return json.data.map(item => ({
          transaction_id: item.transaction_id || item.hash,
          from: item.from_address,
          to: item.to_address,
          value: String(item.amount || item.quant || '0'),
          block_timestamp: item.timestamp || item.block_timestamp || Date.now(),
          type: 'Transfer',
        }));
      }
    }
  } catch (fallbackErr) {
    logger.warn({ err: fallbackErr.message, address }, 'TronScan fallback query failed');
  }

  return [];
}

/**
 * Query TRC-20 token balance for an address
 */
export async function getTrc20Balance(address, contractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') {
  const tronApiUrl = config.tron?.apiUrl || 'https://api.trongrid.io';
  try {
    const res = await fetch(`${tronApiUrl}/v1/accounts/${address}`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const json = await res.json();
      const trc20List = json?.data?.[0]?.trc20 || [];
      for (const token of trc20List) {
        if (token[contractAddress]) {
          return BigInt(token[contractAddress]);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, address }, 'Failed to fetch TronGrid account balance');
  }

  // Fallback to TronScan account API
  try {
    const res = await fetch(`https://apilist.tronscanapi.com/api/account?address=${address}`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const json = await res.json();
      const trc20token_balances = json?.trc20token_balances || [];
      for (const t of trc20token_balances) {
        if (t.tokenId === contractAddress || t.contract_address === contractAddress) {
          return BigInt(t.balance || '0');
        }
      }
    }
  } catch {}

  return 0n;
}
