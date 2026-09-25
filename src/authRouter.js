import express from 'express';
import { z } from 'zod';
import {
  registerMerchant,
  loginUser,
  getMerchantById,
  requestSignupOtp,
  verifySignupOtp,
  requestLoginOtp,
  verifyLoginOtp,
  updateMerchantPayoutSettings,
} from './auth.js';
import { query } from './db.js';
import { authRateLimit, authenticate, assertTrustedWebhookUrl } from './security.js';
import { auditLog, getClientIp } from './audit.js';

const router = express.Router();

const registerSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  name: z.string().min(1).max(60).optional(),
  businessName: z.string().min(2, 'Business name must be at least 2 characters').max(60),
  email: z.string().email('Valid business email is required').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  webhookUrl: z.string().url().optional().or(z.literal('')),
});

const signupOtpRequestSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(60),
  lastName: z.string().min(1, 'Last name is required').max(60),
  businessName: z.string().min(2, 'Business name must be at least 2 characters').max(60),
  email: z.string().email('Valid email address is required').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

const otpVerifySchema = z.object({
  email: z.string().email('Valid email is required'),
  otp: z.string().min(6, 'Verification code must be 6 digits').max(10),
});

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

// 1. Request Signup OTP (Email Verification via Hostinger SMTP)
router.post('/signup/request-otp', authRateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  try {
    const data = signupOtpRequestSchema.parse(req.body);
    const result = await requestSignupOtp(data);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Verify Signup OTP & Create Merchant Account
router.post('/signup/verify-otp', authRateLimit({ windowMs: 60_000, max: 15 }), async (req, res) => {
  try {
    const { email, otp } = otpVerifySchema.parse(req.body);
    const { user, token, message } = await verifySignupOtp({ email, otp });

    // Audit: new merchant registered
    await auditLog({
      action: 'auth.signup',
      actorId: user.id,
      actorRole: 'merchant',
      targetType: 'merchant',
      targetId: user.id,
      ip: getClientIp(req),
      result: 'success',
      details: { email: user.email, businessName: user.businessName },
    });

    res.status(201).json({ message, token, user });
  } catch (err) {
    await auditLog({
      action: 'auth.signup',
      ip: getClientIp(req),
      result: 'failure',
      details: { email: req.body?.email, error: err.message },
    });
    res.status(400).json({ error: err.message });
  }
});

// 3. Request Login 2FA OTP (Email Verification via Hostinger SMTP)
router.post('/login/request-otp', authRateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await requestLoginOtp({ email, password });
    res.json(result);
  } catch (err) {
    // Audit failed login (wrong password / locked account)
    const isLockout = err.message?.toLowerCase().includes('locked');
    await auditLog({
      action: isLockout ? 'auth.account_locked' : 'auth.login_failed',
      ip: getClientIp(req),
      result: 'failure',
      details: { email: req.body?.email, reason: err.message },
    });
    res.status(401).json({ error: err.message });
  }
});

// 4. Verify Login 2FA OTP & Authenticate
router.post('/login/verify-otp', authRateLimit({ windowMs: 60_000, max: 15 }), async (req, res) => {
  try {
    const { email, otp } = otpVerifySchema.parse(req.body);
    const { user, token, message } = await verifyLoginOtp({ email, otp });

    // Audit: successful login
    await auditLog({
      action: 'auth.login_success',
      actorId: user.id,
      actorRole: user.role,
      targetType: 'merchant',
      targetId: user.id,
      ip: getClientIp(req),
      result: 'success',
    });

    res.json({ message, token, user });
  } catch (err) {
    // Audit OTP failure
    await auditLog({
      action: 'auth.otp_invalid',
      ip: getClientIp(req),
      result: 'failure',
      details: { email: req.body?.email, error: err.message },
    });
    res.status(401).json({ error: err.message });
  }
});

// Direct Business/Merchant Registration (No KYC, Direct Fallback)
router.post('/register', authRateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    if (data.webhookUrl) {
      assertTrustedWebhookUrl(data.webhookUrl);
    }

    const firstName = data.firstName || data.name || null;
    const lastName = data.lastName || null;

    const { user, token } = await registerMerchant({
      email: data.email,
      businessName: data.businessName,
      firstName,
      lastName,
      password: data.password,
      webhookUrl: data.webhookUrl || null,
    });

    res.status(201).json({
      message: 'Business account created successfully! You are ready to accept crypto payments.',
      token,
      user,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Direct Merchant & Admin Login (Fallback)
router.post('/login', authRateLimit({ windowMs: 60_000, max: 15 }), async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { user, token } = await loginUser({ email, password });
    res.json({
      message: 'Logged in successfully',
      token,
      user,
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// 3. Current Authenticated Profile
router.get('/me', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const coldRes = await query("SELECT value FROM settings WHERE key = 'cold_storage_address'");
      const autoSweepRes = await query("SELECT value FROM settings WHERE key = 'auto_sweep_enabled'");
      return res.json({
        user: {
          id: 'admin',
          email: req.user.email,
          businessName: 'Platform Super Admin',
          role: 'admin',
          status: 'active',
          walletId: 'default',
          payoutAddress: coldRes.rows[0]?.value || null,
          autoForward: autoSweepRes.rows[0]?.value !== 'false',
        },
      });
    }

    const merchant = await getMerchantById(req.user.id);
    if (!merchant) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: {
        id: merchant.id,
        email: merchant.email,
        firstName: merchant.first_name || null,
        lastName: merchant.last_name || null,
        businessName: merchant.business_name,
        role: merchant.role,
        status: merchant.status,
        walletId: merchant.wallet_id,
        apiKey: merchant.api_key,
        webhookSecret: merchant.webhook_secret,
        webhookUrl: merchant.webhook_url,
        payoutAddress: merchant.payout_address || null,
        autoForward: merchant.auto_forward !== 0,
        createdAt: merchant.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update Personal Payout / Settlement Address
const payoutSettingsSchema = z.object({
  payoutAddress: z.string().optional().nullable(),
  autoForward: z.boolean().optional(),
});

router.post('/profile/payout-address', authenticate, async (req, res) => {
  try {
    const { payoutAddress, autoForward } = payoutSettingsSchema.parse(req.body);

    if (req.user.role === 'admin') {
      if (payoutAddress && payoutAddress.trim()) {
        const { ethers } = await import('ethers');
        if (!ethers.isAddress(payoutAddress.trim())) {
          return res.status(400).json({ error: 'Invalid EVM 0x address' });
        }
        await query(
          `INSERT INTO settings (key, value) VALUES ('cold_storage_address', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [ethers.getAddress(payoutAddress.trim())]
        );
      }
      if (autoForward !== undefined) {
        await query(
          `INSERT INTO settings (key, value) VALUES ('auto_sweep_enabled', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [autoForward ? 'true' : 'false']
        );
      }
      return res.json({ success: true, payoutAddress: payoutAddress?.trim() || null });
    }

    const updated = await updateMerchantPayoutSettings(req.user.id, {
      payoutAddress,
      autoForward,
    });
    res.json({ success: true, merchant: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

export default router;
