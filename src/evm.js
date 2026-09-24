import { ethers } from 'ethers';
import { config } from './config.js';
import { logger } from './logger.js';
import { query } from './db.js';

// Cache providers per chain
const providers = {};

export function getProvider(chain = 'bsc') {
  if (providers[chain]) return providers[chain];

  let rpcUrl = config.evm.rpcUrl;
  if (chain === 'sepolia') rpcUrl = config.sepolia.rpcUrl;
  if (chain === 'polygon') rpcUrl = config.polygon.rpcUrl;

  providers[chain] = new ethers.JsonRpcProvider(rpcUrl);
  return providers[chain];
}

export const evmProvider = getProvider('bsc');

let hdRoot = null;
let isWatchOnly = false;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export async function initEVM() {
  try {
    if (config.evm.mnemonic) {
      hdRoot = ethers.HDNodeWallet.fromPhrase(config.evm.mnemonic, undefined, "m/44'/60'/0'/0");
      isWatchOnly = false;
      logger.info({ address: hdRoot.deriveChild(0).address }, 'EVM initialized from configured EVM_MNEMONIC');
      return true;
    }

    if (config.evm.xpub && config.evm.xpub !== 'your_evm_xpub_here') {
      hdRoot = ethers.HDNodeWallet.fromExtendedKey(config.evm.xpub);
      isWatchOnly = true;
      logger.info('EVM initialized with watch-only EVM_XPUB');
      return true;
    }

    // Auto-initialize or load master mnemonic from settings table
    const settingRes = await query("SELECT value FROM settings WHERE key = 'master_hd_mnemonic'");
    let mnemonic = settingRes.rows.length ? settingRes.rows[0].value : null;

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

    hdRoot = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0");
    isWatchOnly = false;
    logger.info({ masterAddress: hdRoot.deriveChild(0).address }, 'EVM HD Wallet initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to initialize EVM HD Wallet');
    return false;
  }
}

export function deriveAddress(index) {
  if (!hdRoot) throw new Error('EVM not initialized');
  const child = hdRoot.deriveChild(index);
  return child.address;
}

export function derivePrivateKey(index) {
  if (!hdRoot || isWatchOnly) return null;
  const child = hdRoot.deriveChild(index);
  return child.privateKey;
}

export function isWatchOnlyWallet() {
  return isWatchOnly;
}

export function getCentralTreasuryAddress() {
  if (config.treasuryAddress) {
    return ethers.getAddress(config.treasuryAddress);
  }
  if (config.treasuryPrivateKey) {
    const w = new ethers.Wallet(config.treasuryPrivateKey);
    return w.address;
  }
  return deriveAddress(0);
}

export function getTreasuryPrivateKey() {
  if (config.treasuryPrivateKey) {
    return config.treasuryPrivateKey;
  }
  return derivePrivateKey(0);
}

export async function getBlockNumber(chain = 'bsc') {
  const provider = getProvider(chain);
  return await provider.getBlockNumber();
}

export async function getNativeBalance(address, chain = 'bsc') {
  const provider = getProvider(chain);
  const balance = await provider.getBalance(address);
  return balance;
}

export async function getTokenBalance(address, tokenContract, chain = 'bsc') {
  const provider = getProvider(chain);
  const contract = new ethers.Contract(tokenContract, ERC20_ABI, provider);
  return await contract.balanceOf(address);
}

export async function getTransactionReceipt(txid, chain = 'bsc') {
  const provider = getProvider(chain);
  return await provider.getTransactionReceipt(txid);
}

export async function getLogs(fromBlock, toBlock, addresses, tokenContract, chain = 'bsc') {
  const provider = getProvider(chain);
  const topic = ethers.id('Transfer(address,address,uint256)');
  const filter = {
    fromBlock,
    toBlock,
    topics: [
      topic,
      null,
      addresses.map(a => ethers.zeroPadValue(a, 32)),
    ],
  };
  if (tokenContract) {
    filter.address = tokenContract;
  }
  return await provider.getLogs(filter);
}

/**
 * Real on-chain withdrawal / payout execution
 * Signs transaction with hot wallet signer and broadcasts to blockchain RPC
 */
export async function sendOnChainPayout({
  chain = 'bsc',
  toAddress,
  amount,
  decimals = 18,
  isNative = true,
  tokenContract = null,
}) {
  if (!ethers.isAddress(toAddress)) {
    throw new Error(`Invalid recipient address: ${toAddress}`);
  }

  const provider = getProvider(chain);

  // Determine private key to sign the transaction
  let signerKey = config.treasuryPrivateKey;
  if (!signerKey) {
    // Fall back to root child 0 key if mnemonic is active
    signerKey = derivePrivateKey(0);
  }

  if (!signerKey) {
    throw new Error('No signing key configured for on-chain payouts. Set TREASURY_PRIVATE_KEY in .env');
  }

  const signer = new ethers.Wallet(signerKey, provider);
  const amountUnits = ethers.parseUnits(amount.toString(), decimals);

  let tx;
  if (isNative) {
    // Check signer native balance
    const signerBalance = await provider.getBalance(signer.address);
    if (signerBalance < amountUnits) {
      throw new Error(`Treasury address ${signer.address} has insufficient native balance (${ethers.formatEther(signerBalance)} available)`);
    }

    tx = await signer.sendTransaction({
      to: toAddress,
      value: amountUnits,
    });
  } else {
    if (!tokenContract) throw new Error('tokenContract required for token payout');
    const contract = new ethers.Contract(tokenContract, ERC20_ABI, signer);

    const tokenBalance = await contract.balanceOf(signer.address);
    if (tokenBalance < amountUnits) {
      throw new Error(`Treasury address ${signer.address} has insufficient token balance (${ethers.formatUnits(tokenBalance, decimals)} available)`);
    }

    tx = await contract.transfer(toAddress, amountUnits);
  }

  logger.info({ txid: tx.hash, to: toAddress, amount, chain }, 'Broadcasted real on-chain payout transaction');
  return {
    txid: tx.hash,
    from: signer.address,
    to: toAddress,
    amount,
    chain,
  };
}
