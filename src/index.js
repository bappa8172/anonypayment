import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertProductionConfiguration, config } from './config.js';
import { logger } from './logger.js';
import { initDb } from './db.js';
import adminRouter from './admin.js';
import publicRouter from './public.js';
import { startEVMMonitor } from './monitors/evmMonitor.js';
import { initEVM } from './evm.js';
import { basicRateLimit } from './security.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure Helmet with relaxed CSP for local frontend & QR codes
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb', type: 'application/json' }));

// Static assets
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Routes
app.use('/v1', basicRateLimit({ max: 300 }));
app.use('/admin', adminRouter);
app.use('/v1', publicRouter);

// Checkout and Dashboard entry points
app.get('/pay', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    networkMode: config.networkMode,
    activeChainId: config.evm.chainId,
    timestamp: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  logger.warn({ err: err.message, path: req.path }, 'Request error');
  res.status(400).json({ error: err.message || 'Invalid request' });
});

async function main() {
  assertProductionConfiguration();
  await initDb();
  await initEVM();
  await startEVMMonitor();

  app.listen(config.port, () => {
    logger.info(`=================================================`);
    logger.info(`🚀 Crypto Payment Gateway & Wallet is LIVE!`);
    logger.info(`🌐 Dashboard: http://localhost:${config.port}/dashboard`);
    logger.info(`💳 Checkout:  http://localhost:${config.port}/pay?invoice=<id>`);
    logger.info(`⚙️  Network:   ${config.networkMode.toUpperCase()} (Chain ID: ${config.evm.chainId})`);
    logger.info(`🔑 API Key:   ${config.adminApiKey.slice(0, 10)}...`);
    logger.info(`=================================================`);
  });
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
