import Client from 'bitcoin-core';
import { config } from './config.js';
import { logger } from './logger.js';

const clientOptions = {
  host: config.btc.rpcHost,
  port: config.btc.rpcPort,
  username: config.btc.rpcUser,
  password: config.btc.rpcPassword,
};

const nodeClient = new Client(clientOptions);
export const btcClient = new Client({ ...clientOptions, wallet: config.btc.wallet });

export async function ensureWallet() {
  try {
    await nodeClient.createWallet(config.btc.wallet, true, true, '', true, true);
    logger.info('Created BTC wallet');
  } catch (err) {
    if (err.message.includes('already exists')) {
      logger.info('BTC wallet already exists');
    } else {
      throw err;
    }
  }

  const loadedWallets = await nodeClient.listWallets();
  if (!loadedWallets.includes(config.btc.wallet)) {
    await nodeClient.loadWallet(config.btc.wallet);
    logger.info('Loaded BTC wallet');
  }

  if (config.btc.xpub) {
    const descriptor = `wpkh([00000000/84'/0'/0']${config.btc.xpub}/0/*)`;
    try {
      await btcClient.importDescriptors([{
        desc: descriptor,
        active: true,
        internal: false,
        timestamp: 'now',
      }]);
      logger.info('Imported BTC descriptor');
    } catch (err) {
      if (!err.message.includes('already')) {
        logger.warn({ err }, 'BTC descriptor import failed');
      }
    }
  }
}

export async function getNewAddress(label) {
  return await btcClient.getNewAddress(label);
}

export async function getReceivedByAddress(address, minconf = 0) {
  return await btcClient.getReceivedByAddress(address, minconf);
}

export async function listsinceblock(blockhash = null, minconf = 1) {
  return await btcClient.listSinceBlock(blockhash, minconf, true, false);
}

export async function getBlockCount() {
  return await nodeClient.getBlockCount();
}

export async function getBlockHash(blockCount) {
  return await nodeClient.getBlockHash(blockCount);
}
