import { ethers } from 'ethers';
import { initDb, query } from '../src/db.js';
import { initEVM, derivePrivateKey, deriveAddress, getProvider } from '../src/evm.js';
import { getAsset } from '../src/assets.js';
import { logger } from '../src/logger.js';

const DESTINATION_ADDRESS = '0xa4ad9388fDEC212410a1384Cc12172EDb80e70e1';
const INVOICE_INDEX = 14;
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export async function executeDirectPayout() {
  await initDb();
  await initEVM();

  const provider = getProvider('bsc');
  const sourceAddress = deriveAddress(INVOICE_INDEX);
  const privateKey = derivePrivateKey(INVOICE_INDEX);

  if (!privateKey) {
    throw new Error('Unable to derive private key for index ' + INVOICE_INDEX);
  }

  const signer = new ethers.Wallet(privateKey, provider);
  const usdt = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, signer);

  const nativeBal = await provider.getBalance(sourceAddress);
  const tokenBal = await usdt.balanceOf(sourceAddress);

  console.log('Source Address:', sourceAddress);
  console.log('Native BNB Balance:', ethers.formatEther(nativeBal), 'BNB');
  console.log('USDT Balance:', ethers.formatUnits(tokenBal, 18), 'USDT');
  console.log('Target Destination:', DESTINATION_ADDRESS);

  if (tokenBal === 0n) {
    console.log('No USDT tokens on this address.');
    return;
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('3', 'gwei');
  const estimatedGas = 65000n;
  const gasCost = estimatedGas * gasPrice;

  if (nativeBal < gasCost) {
    console.log('----------------------------------------------------');
    console.log('⚠️ INSUFFICIENT BNB GAS TO BROADCAST TRANSACTION');
    console.log('Gas required:', ethers.formatEther(gasCost), 'BNB (~$0.05)');
    console.log('Available gas:', ethers.formatEther(nativeBal), 'BNB');
    console.log('Send ~0.0005 BNB to:', sourceAddress);
    console.log('Once sent, re-run this script to broadcast immediately!');
    console.log('----------------------------------------------------');
    return { success: false, reason: 'insufficient_gas', requiredBnb: ethers.formatEther(gasCost), sourceAddress };
  }

  console.log('Broadcasting transfer of', ethers.formatUnits(tokenBal, 18), 'USDT to', DESTINATION_ADDRESS);
  const tx = await usdt.transfer(DESTINATION_ADDRESS, tokenBal, {
    gasLimit: estimatedGas,
    gasPrice,
  });

  console.log('Transaction Broadcasted! TxHash:', tx.hash);
  console.log('BscScan URL: https://bscscan.com/tx/' + tx.hash);

  const receipt = await tx.wait(1);
  console.log('Confirmed in block:', receipt.blockNumber);

  // Update invoice sweep status
  await query(
    "UPDATE invoices SET sweep_status = 'swept', sweep_txid = $1, swept_amount = $2, swept_at = datetime('now') WHERE derivation_index = $3",
    [tx.hash, ethers.formatUnits(tokenBal, 18), INVOICE_INDEX]
  );

  return { success: true, txid: tx.hash, blockNumber: receipt.blockNumber };
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('payout_direct.js')) {
  executeDirectPayout()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
