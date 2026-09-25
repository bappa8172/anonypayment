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
import authRouter from './authRouter.js';
import merchantApiRouter from './merchantApiRouter.js';
import { startEVMMonitor } from './monitors/evmMonitor.js';
import { initEVM } from './evm.js';
import { basicRateLimit, globalRateLimit } from './security.js';
import { initMailer } from './mailer.js';
import { purgeExpiredOtps, purgeExpiredLockouts } from './auth.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = config.environment !== 'production';

// ============================================================
// SECURITY HEADERS — Helmet with strict Content Security Policy
// ============================================================
app.use(helmet({
  // Content Security Policy — only allow resources from same origin
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // unsafe-inline needed for inline dashboard scripts
      styleSrc:  ["'self'", "'unsafe-inline'"],
      imgSrc:    ["'self'", 'data:', 'https:'],    // data: needed for QR codes
      connectSrc: ["'self'"],
      fontSrc:   ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameSrc:  ["'none'"],
      upgradeInsecureRequests: isDev ? null : [],
    },
  },
  // Strict Transport Security — 1 year with subdomains
  hsts: isDev ? false : {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Permissions-Policy — disable all browser APIs not needed for a payment gateway
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=(), magnetometer=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ============================================================
// CORS — Restrict to configured origins only
// ============================================================
const corsOrigins = config.corsOrigin;
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl)
    if (!origin) return callback(null, true);
    // Allow wildcard in development
    if (corsOrigins.includes('*')) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    logger.warn({ origin }, 'CORS blocked request from unauthorized origin');
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  maxAge: 86400, // 24h preflight cache
};
app.use(cors(corsOptions));
app.disable('x-powered-by');

// ============================================================
// GLOBAL RATE LIMITER — First line of defense against floods
// 200 requests per IP per minute across the entire gateway
// ============================================================
app.use(globalRateLimit({ windowMs: 60_000, max: 200 }));

// ============================================================
// REQUEST BODY LIMITS — Prevent oversized payload attacks
// ============================================================
// Auth routes — tiny limit (credentials only)
app.use('/auth', express.json({ limit: '4kb', type: 'application/json' }));
// Merchant API routes — moderate limit
app.use('/v1/merchant', express.json({ limit: '20kb', type: 'application/json' }));
// Admin routes — moderate limit
app.use('/admin', express.json({ limit: '20kb', type: 'application/json' }));
// Everything else
app.use(express.json({ limit: '50kb', type: 'application/json' }));

// ============================================================
// STATIC ASSETS
// ============================================================
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ============================================================
// ROUTES
// ============================================================
app.use('/auth', authRouter);
app.use('/v1/merchant', merchantApiRouter);
app.use('/v1', basicRateLimit({ max: 300 }));
app.use('/admin', adminRouter);
app.use('/v1', publicRouter);

// ============================================================
// PAGE ENTRY POINTS
// ============================================================
app.get('/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'auth.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(publicDir, 'auth.html'));
});

app.get('/pay', (req, res) => {
  res.sendFile(path.join(publicDir, 'pay.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ============================================================
// HEALTH CHECK — Minimal info leak
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// GLOBAL ERROR HANDLER — Never leak stack traces
// ============================================================
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 400;

  // Log full error internally
  logger.warn({ err: err.message, path: req.path, method: req.method, ip: req.ip }, 'Request error');

  // Return sanitized error to client — no stack traces
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Cross-origin request not permitted' });
  }
  res.status(status).json({ error: err.message || 'Invalid request' });
});

// ============================================================
// STARTUP
// ============================================================
async function main() {
  assertProductionConfiguration();
  await initDb();
  initMailer();
  await initEVM();
  await startEVMMonitor();

  // ── Periodic Security Cleanup Jobs ─────────────────────────────────────
  // Run every 5 minutes: purge expired OTPs and stale lockout records
  setInterval(async () => {
    await purgeExpiredOtps();
    await purgeExpiredLockouts();
  }, 5 * 60 * 1000);

  app.listen(config.port, () => {
    logger.info(`=================================================`);
    logger.info(`🚀 Crypto Payment Gateway & Wallet is LIVE!`);
    logger.info(`🌐 Dashboard: http://localhost:${config.port}/dashboard`);
    logger.info(`💳 Checkout:  http://localhost:${config.port}/pay?invoice=<id>`);
    logger.info(`⚙️  Network:   ${config.networkMode.toUpperCase()} (Chain ID: ${config.evm.chainId})`);
    logger.info(`🔑 Admin Key: ${config.adminApiKey.slice(0, 10)}...`);
    logger.info(`🛡️  Security:  ${config.environment.toUpperCase()} mode`);
    logger.info(`=================================================`);
  });
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
