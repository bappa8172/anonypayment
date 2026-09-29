import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { assertProductionConfiguration, config } from './config.js';
import { logger } from './logger.js';
import { initDb } from './db.js';
import adminRouter from './admin.js';
import publicRouter from './public.js';
import authRouter from './authRouter.js';
import merchantApiRouter from './merchantApiRouter.js';
import { startEVMMonitor } from './monitors/evmMonitor.js';
import { startTronMonitor } from './monitors/tronMonitor.js';
import { startBTCMonitor } from './monitors/btcMonitor.js';
import { initEVM } from './evm.js';
import { initTron } from './tron.js';
import { initBTC } from './btcWallet.js';
import { basicRateLimit, globalRateLimit } from './security.js';
import { initMailer } from './mailer.js';
import { purgeExpiredOtps, purgeExpiredLockouts } from './auth.js';
import { sanitizeErrorForResponse, redactSensitiveData } from './errors.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = config.environment !== 'production';

// ============================================================
// SECURITY HEADERS — Helmet with strict Content Security Policy
// ============================================================
app.use(helmet({
  // Content Security Policy — allow resources needed for dashboard & fonts
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // unsafe-inline needed for inline dashboard scripts
      styleSrc:  ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:    ["'self'", 'data:', 'https:'],    // data: needed for QR codes
      connectSrc: ["'self'", ...(isDev ? ['http://localhost:*', 'ws://localhost:*'] : [])],
      fontSrc:   ["'self'", 'data:', 'https://fonts.gstatic.com'],
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
// API ROUTES
// ============================================================
app.use('/auth', authRouter);
app.use('/v1/merchant', merchantApiRouter);
app.use('/v1', basicRateLimit({ max: 300 }));
app.use('/admin', adminRouter);
app.use('/v1', publicRouter);

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
// FRONTEND SERVING & SPA FALLBACK (Production & Embedded UI)
// ============================================================
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
const hasClientDist = fs.existsSync(clientDistPath);
const frontendUrl = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';

// Payment link resolution: /link/:code -> redirects to checkout
app.get('/link/:code', (req, res) => {
  if (hasClientDist) {
    return res.redirect(`/pay?link=${encodeURIComponent(req.params.code)}`);
  }
  return res.redirect(`${frontendUrl}/pay?link=${encodeURIComponent(req.params.code)}`);
});

// Root API Endpoint (for JSON API clients)
app.get('/', (req, res, next) => {
  if (req.accepts('json') && !req.accepts('html')) {
    return res.json({
      name: 'AnonyGateway Crypto API',
      status: 'online',
      version: '1.0.0',
      network: config.networkMode,
      endpoints: {
        health: '/health',
        auth: '/auth',
        merchant: '/v1/merchant',
        public: '/v1',
        admin: '/admin',
      },
    });
  }
  next();
});

if (hasClientDist) {
  // Serve compiled static assets (JS, CSS, images, fonts)
  app.use(express.static(clientDistPath));

  // SPA fallback for all frontend routes (excluding API prefixes)
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/v1') ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/auth') ||
      req.path.startsWith('/health')
    ) {
      return next();
    }
    if (req.accepts('html')) {
      return res.sendFile(path.join(clientDistPath, 'index.html'));
    }
    next();
  });
} else {
  // Development fallback when frontend is running via Vite on separate port
  app.get(['/dashboard', '/pay', '/login', '/signup', '/flow-demo', '/demo'], (req, res) => {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(`${frontendUrl}${req.path}${query}`);
  });

  app.get('/', (req, res) => {
    res.redirect(frontendUrl);
  });
}

// ============================================================
// 404 HANDLER FOR UNMATCHED ROUTES
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' });
});

// ============================================================
// GLOBAL ERROR HANDLER — Never leak critical data, keys, or stack traces
// ============================================================
app.use((err, req, res, next) => {
  const sanitized = sanitizeErrorForResponse(err, isDev);

  // Redact any sensitive data (keys, passwords, secrets, paths) from the server log
  const safeLogErr = redactSensitiveData({
    message: err?.message,
    stack: err?.stack,
    code: err?.code || sanitized.body.code,
    statusCode: sanitized.statusCode,
    requestId: sanitized.body.requestId,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  if (sanitized.statusCode >= 500) {
    logger.error(safeLogErr, 'Unhandled server error');
  } else {
    logger.warn(safeLogErr, 'Operational request error');
  }

  // Send purely sanitized payload to the client
  return res.status(sanitized.statusCode).json(sanitized.body);
});

// ============================================================
// PROCESS-LEVEL EXCEPTION SAFEGUARDS
// ============================================================
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  logger.error({ error: redactSensitiveData(msg) }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ error: redactSensitiveData(err?.stack || err?.message) }, 'Uncaught Exception');
  process.exit(1);
});

// ============================================================
// STARTUP
// ============================================================
async function main() {
  assertProductionConfiguration();
  await initDb();
  initMailer();
  await initEVM();
  await initTron();
  await initBTC();
  app.listen(config.port, () => {
    logger.info(`=================================================`);
    logger.info(`🚀 AnonyGateway Server is LIVE!`);
    logger.info(`🌐 Frontend UI:  ${frontendUrl}`);
    logger.info(`🔌 API Backend:  http://localhost:${config.port}`);
    logger.info(`🩺 Health Check: http://localhost:${config.port}/health`);
    logger.info(`⚙️  Network:     ${config.networkMode.toUpperCase()} (Chain ID: ${config.evm.chainId})`);
    logger.info(`🔑 Admin Key:   ${config.adminApiKey.slice(0, 10)}...`);
    logger.info(`🛡️  Security:    ${config.environment.toUpperCase()} mode`);
    logger.info(`=================================================`);
  });

  // ── Periodic Security Cleanup Jobs ─────────────────────────────────────
  // Run every 5 minutes: purge expired OTPs and stale lockout records
  setInterval(async () => {
    await purgeExpiredOtps();
    await purgeExpiredLockouts();
  }, 5 * 60 * 1000);

  // Start background payment monitors asynchronously
  startEVMMonitor().catch(err => logger.error({ err: err.message }, 'EVM monitor startup error'));
  startTronMonitor().catch(err => logger.error({ err: err.message }, 'Tron monitor startup error'));
  startBTCMonitor().catch(err => logger.error({ err: err.message }, 'BTC monitor startup error'));
}

main().catch(err => {
  logger.error({ error: redactSensitiveData(err?.stack || err?.message) }, 'Gateway fatal startup failure');
  process.exit(1);
});
