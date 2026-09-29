import { ethers } from 'ethers';
import { initDb, query } from '../src/db.js';
import { initEVM, derivePrivateKey, deriveAddress, getProvider } from '../src/evm.js';

const DESTINATION_ADDRESS = '0xa4ad9388fDEC212410a1384Cc12172EDb80e70e1';
const INVOICE_INDEX = 14;
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

async function main() {
  await initDb();
  await initEVM();

  const provider = getProvider('bsc');
  const sourceAddress = deriveAddress(INVOICE_INDEX);
  const privateKey = derivePrivateKey(INVOICE_INDEX);
  const signer = new ethers.Wallet(privateKey, provider);
  const usdt = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, signer);

  console.log(`[Watcher Active] Monitoring ${sourceAddress} for gas to transfer 0.01 USDT to ${DESTINATION_ADDRESS}...`);

  const check = async () => {
    try {
      const bnbBal = await provider.getBalance(sourceAddress);
      const usdtBal = await usdt.balanceOf(sourceAddress);

      if (usdtBal === 0n) {
        console.log('[Watcher] USDT balance is 0. Transfer already completed!');
        process.exit(0);
      }

      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('3', 'gwei');
      const gasCost = 65000n * gasPrice;

      if (bnbBal >= gasCost) {
        console.log(`[Watcher] Gas detected (${ethers.formatEther(bnbBal)} BNB)! Broadcasting 0.01 USDT to ${DESTINATION_ADDRESS}...`);
        const tx = await usdt.transfer(DESTINATION_ADDRESS, usdtBal, {
          gasLimit: 65000n,
          gasPrice,
        });
        console.log(`[Watcher] Payout Broadcasted! TxHash: ${tx.hash}`);
        console.log(`[Watcher] BscScan URL: https://bscscan.com/tx/${tx.hash}`);
        await tx.wait(1);
        console.log('[Watcher] Payout confirmed on BSC!');
        process.exit(0);
      }
    } catch (e) {
      console.warn('[Watcher check error]:', e.message);
    }
  };

  await check();
  setInterval(check, 6000);
}

main();
