import express from 'express';
import { z } from 'zod';
import { registerMerchant, loginUser, getMerchantById } from './auth.js';
import { authRateLimit, authenticate, assertTrustedWebhookUrl } from './security.js';

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email('Valid business email is required').max(100),
  businessName: z.string().min(2, 'Business name must be at least 2 characters').max(60),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  webhookUrl: z.string().url().optional().or(z.literal('')),
});

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

// 1. Instant Business/Merchant Registration (No KYC, No Documents)
router.post('/register', authRateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    if (data.webhookUrl) {
      assertTrustedWebhookUrl(data.webhookUrl);
    }

    const { user, token } = await registerMerchant({
      email: data.email,
      businessName: data.businessName,
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

// 2. Merchant & Admin Login
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
      return res.json({
        user: {
          id: 'admin',
          email: req.user.email,
          businessName: 'Platform Super Admin',
          role: 'admin',
          status: 'active',
          walletId: 'default',
        },
      });
    }

    const merchant = await getMerchantById(req.user.id);
    if (!merchant) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: {
        id: merchant.id,
        email: merchant.email,
        businessName: merchant.business_name,
        role: merchant.role,
        status: merchant.status,
        walletId: merchant.wallet_id,
        apiKey: merchant.api_key,
        webhookSecret: merchant.webhook_secret,
        webhookUrl: merchant.webhook_url,
        createdAt: merchant.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

export default router;
