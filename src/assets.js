import { config } from './config.js';

export const ASSETS = {
  BNB_BSC: {
    currency: 'BNB_BSC',
    symbol: 'BNB',
    name: 'BNB (BNB Smart Chain)',
    chain: 'bsc',
    chainId: config.evm.chainId,
    isNative: true,
    contract: null,
    decimals: 18,
    explorerTx: config.evm.chainId === 97
      ? 'https://testnet.bscscan.com/tx/'
      : 'https://bscscan.com/tx/',
    explorerAddress: config.evm.chainId === 97
      ? 'https://testnet.bscscan.com/address/'
      : 'https://bscscan.com/address/',
  },
  USDT_BSC: {
    currency: 'USDT_BSC',
    symbol: 'USDT',
    name: 'Tether USD (BEP-20)',
    chain: 'bsc',
    chainId: config.evm.chainId,
    isNative: false,
    contract: config.evm.usdtContract,
    decimals: config.evm.usdtDecimals,
    explorerTx: config.evm.chainId === 97
      ? 'https://testnet.bscscan.com/tx/'
      : 'https://bscscan.com/tx/',
    explorerAddress: config.evm.chainId === 97
      ? 'https://testnet.bscscan.com/address/'
      : 'https://bscscan.com/address/',
  },
  ETH_SEPOLIA: {
    currency: 'ETH_SEPOLIA',
    symbol: 'ETH',
    name: 'Ethereum (Sepolia Testnet)',
    chain: 'sepolia',
    chainId: config.sepolia.chainId,
    isNative: true,
    contract: null,
    decimals: 18,
    explorerTx: 'https://sepolia.etherscan.io/tx/',
    explorerAddress: 'https://sepolia.etherscan.io/address/',
  },
  USDT_SEPOLIA: {
    currency: 'USDT_SEPOLIA',
    symbol: 'USDT',
    name: 'Tether USD (Sepolia Testnet)',
    chain: 'sepolia',
    chainId: config.sepolia.chainId,
    isNative: false,
    contract: config.sepolia.usdtContract,
    decimals: config.sepolia.usdtDecimals,
    explorerTx: 'https://sepolia.etherscan.io/tx/',
    explorerAddress: 'https://sepolia.etherscan.io/address/',
  },
  MATIC_POLYGON: {
    currency: 'MATIC_POLYGON',
    symbol: 'POL',
    name: 'Polygon Ecosystem Token (POL/MATIC)',
    chain: 'polygon',
    chainId: config.polygon.chainId,
    isNative: true,
    contract: null,
    decimals: 18,
    explorerTx: 'https://polygonscan.com/tx/',
    explorerAddress: 'https://polygonscan.com/address/',
  },
  USDT_TRC20: {
    currency: 'USDT_TRC20',
    symbol: 'USDT',
    name: 'Tether USD (TRC-20)',
    chain: 'tron',
    chainId: null,
    isNative: false,
    contract: config.tron?.usdtContract || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals: 6,
    explorerTx: 'https://tronscan.org/#/transaction/',
    explorerAddress: 'https://tronscan.org/#/address/',
  },
  BTC: {
    currency: 'BTC',
    symbol: 'BTC',
    name: 'Bitcoin (Native SegWit)',
    chain: 'btc',
    chainId: null,
    isNative: true,
    contract: null,
    decimals: 8,
    explorerTx: 'https://mempool.space/tx/',
    explorerAddress: 'https://mempool.space/address/',
  },
};

export const USDT_BSC = 'USDT_BSC';

export function getAsset(currency) {
  const asset = ASSETS[currency];
  if (!asset) {
    const supported = Object.keys(ASSETS).join(', ');
    throw new Error(`Unsupported currency: ${currency}. Supported: ${supported}`);
  }
  return asset;
}

export function getAllAssets() {
  return Object.values(ASSETS);
}
