import dotenv from 'dotenv';
dotenv.config();

const networkMode = process.env.NETWORK_MODE || 'testnet';

export const config = {
  environment: process.env.NODE_ENV || 'development',
  networkMode,
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  adminApiKey: process.env.ADMIN_API_KEY || 'gateway_admin_secret_key_prod_test_32chars',
  webhookSecret: process.env.WEBHOOK_SECRET || 'gateway_webhook_secret_key_test_32chars',
  trustedWebhookHosts: (process.env.WEBHOOK_ALLOWED_HOSTS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
  treasuryPrivateKey: process.env.TREASURY_PRIVATE_KEY,
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || '3000'}`,
  email: {
    enabled: process.env.SMTP_ENABLED !== 'false',
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true' || (process.env.SMTP_PORT ? process.env.SMTP_PORT === '465' : true),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'main@grossorymart.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Grossory Mart Payments',
  },
  evm: {
    mnemonic: process.env.EVM_MNEMONIC,
    xpub: process.env.EVM_XPUB && process.env.EVM_XPUB !== 'your_evm_xpub_here'
      ? process.env.EVM_XPUB
      : undefined,
    rpcUrl: process.env.EVM_RPC_URL || (networkMode === 'mainnet'
      ? 'https://bsc-dataseed.binance.org'
      : 'https://bsc-testnet.publicnode.com'),
    chainId: parseInt(process.env.EVM_CHAIN_ID || (networkMode === 'mainnet' ? '56' : '97'), 10),
    confirmations: parseInt(process.env.EVM_CONFIRMATIONS || (networkMode === 'mainnet' ? '12' : '2'), 10),
    usdtContract: process.env.USDT_BSC_CONTRACT || (networkMode === 'mainnet'
      ? '0x55d398326f99059fF775485246999027B3197955'
      : '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'),
    usdtDecimals: parseInt(process.env.USDT_BSC_DECIMALS || '18', 10),
  },
  sepolia: {
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    chainId: 11155111,
    confirmations: 2,
    usdtContract: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
    usdtDecimals: 6,
  },
  polygon: {
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
    chainId: 137,
    confirmations: 5,
  }
};

export function assertProductionConfiguration() {
  if (config.environment !== 'production') return;
  const missing = [
    ['DATABASE_URL', config.databaseUrl],
    ['ADMIN_API_KEY', config.adminApiKey],
    ['WEBHOOK_SECRET', config.webhookSecret],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
  }
  if (config.adminApiKey.length < 32 || config.webhookSecret.length < 32) {
    throw new Error('ADMIN_API_KEY and WEBHOOK_SECRET must each be at least 32 characters');
  }
}
