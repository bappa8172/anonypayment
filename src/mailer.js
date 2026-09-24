import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { logger } from './logger.js';
import { query } from './db.js';

let transporter = null;

export function initMailer() {
  const { host, port, secure, user, pass } = config.email;

  if (host && user) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    logger.info({ host, port, user }, 'SMTP email transport initialized for live delivery');
  } else {
    // Development / Simulated mode: outputs emails cleanly without crashing or requiring live SMTP credentials
    transporter = {
      sendMail: async (mailOptions) => {
        logger.info(
          {
            to: mailOptions.to,
            subject: mailOptions.subject,
            preview: (mailOptions.text || '').slice(0, 100),
          },
          'Simulated email dispatch (SMTP credentials not configured in .env)'
        );
        return {
          messageId: `sim_${uuidv4()}`,
          response: '250 Simulated Message Queued',
        };
      },
    };
    logger.info('Email service initialized in simulation/preview mode (set SMTP_HOST and SMTP_USER in .env for live sending)');
  }
  return transporter;
}

export async function getEmailTransporter() {
  if (!transporter) {
    initMailer();
  }
  return transporter;
}

/**
 * Universal email dispatcher that records full audit trail into email_logs
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  recipientType = 'customer',
  template = 'general',
  invoiceId = null,
  merchantId = null,
}) {
  if (!config.email.enabled) {
    logger.info({ to, subject }, 'Email sending is disabled via config');
    return { success: false, status: 'disabled' };
  }

  if (!to || !to.includes('@')) {
    logger.warn({ to, subject }, 'Invalid recipient email provided; skipping email dispatch');
    return { success: false, status: 'invalid_recipient' };
  }

  const mailClient = await getEmailTransporter();
  const emailLogId = uuidv4();
  const isRealSmtp = Boolean(config.email.host && config.email.user);

  try {
    const info = await mailClient.sendMail({
      from: `"${config.email.fromName}" <${config.email.from}>`,
      to,
      subject,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      html,
    });

    const status = isRealSmtp ? 'sent' : 'simulated';
    const previewText = (text || subject).slice(0, 200);

    await query(
      `INSERT INTO email_logs (id, recipient, recipient_type, subject, template, invoice_id, merchant_id, status, error, preview_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, datetime('now'))`,
      [emailLogId, to, recipientType, subject, template, invoiceId, merchantId, status, previewText]
    );

    logger.info({ to, subject, status, logId: emailLogId, messageId: info.messageId }, 'Email recorded in audit trail');
    return { success: true, status, logId: emailLogId, messageId: info.messageId };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'Failed to deliver email');

    await query(
      `INSERT INTO email_logs (id, recipient, recipient_type, subject, template, invoice_id, merchant_id, status, error, preview_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed', $8, $9, datetime('now'))`,
      [emailLogId, to, recipientType, subject, template, invoiceId, merchantId, err.message, (text || subject).slice(0, 200)]
    );

    return { success: false, status: 'failed', error: err.message };
  }
}

/**
 * 1. Email to Customer when Invoice is Generated
 */
export function buildInvoiceCreatedHtml({ invoice, merchant, checkoutUrl }) {
  const businessName = merchant?.business_name || 'Payrail Merchant';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b111e; color: #f1f5f9; margin: 0; padding: 24px; }
    .card { max-width: 560px; margin: 0 auto; background: #131d2e; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; color: #ffffff; }
    .content { padding: 28px; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }
    .label { color: #94a3b8; }
    .value { color: #f8fafc; font-weight: 600; text-align: right; }
    .amount-box { text-align: center; margin: 24px 0; padding: 20px; background: #0b1322; border-radius: 8px; border: 1px solid #22344d; }
    .amount-val { font-size: 28px; font-weight: 800; color: #10b981; }
    .btn { display: inline-block; width: 100%; box-sizing: border-box; background: #10b981; color: #ffffff; text-align: center; padding: 14px 20px; font-size: 16px; font-weight: 600; border-radius: 8px; text-decoration: none; margin-top: 20px; }
    .footer { text-align: center; font-size: 12px; color: #64748b; padding: 20px; }
    .code { font-family: monospace; background: #0f172a; padding: 4px 8px; border-radius: 4px; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Payment Invoice Ready</h1>
    </div>
    <div class="content">
      <p style="margin-top: 0; font-size: 15px; color: #cbd5e1;">
        Hello, you have a new payment invoice from <strong>${businessName}</strong>.
      </p>

      <div class="amount-box">
        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">Total Amount Due</div>
        <div class="amount-val">${invoice.amount} ${invoice.currency}</div>
      </div>

      <div class="row">
        <span class="label">Invoice ID</span>
        <span class="value">${invoice.id.slice(0, 13)}…</span>
      </div>
      ${(invoice.order_id || invoice.orderId) ? `
      <div class="row">
        <span class="label">Order Reference</span>
        <span class="value">${invoice.order_id || invoice.orderId}</span>
      </div>` : ''}
      ${invoice.description ? `
      <div class="row">
        <span class="label">Item / Description</span>
        <span class="value">${invoice.description}</span>
      </div>` : ''}
      <div class="row">
        <span class="label">Payment Network</span>
        <span class="value">${invoice.currency.includes('BSC') ? 'BNB Smart Chain (BSC Mainnet)' : invoice.currency}</span>
      </div>
      <div class="row">
        <span class="label">Deposit Address</span>
        <span class="value"><code class="code">${invoice.address}</code></span>
      </div>

      <a href="${checkoutUrl}" class="btn" target="_blank">Pay Now on Secure Checkout ⚡</a>
    </div>
    <div class="footer">
      Powered by Payrail Real-Time Crypto Payment Gateway
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * 2. Email to Business Owner (Merchant) when Payment is Received
 */
export function buildPaymentReceivedMerchantHtml({ invoice, merchant, txid, confirmations }) {
  const businessName = merchant?.business_name || 'Merchant';
  const explorerUrl = txid && txid.startsWith('0x') ? `https://bscscan.com/tx/${txid}` : null;
  const dashboardUrl = `${config.publicUrl}/dashboard`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #090e17; color: #f1f5f9; margin: 0; padding: 24px; }
    .card { max-width: 580px; margin: 0 auto; background: #131e31; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #10b981 0%, #047857 100%); padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; color: #ffffff; }
    .badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-top: 6px; }
    .content { padding: 28px; }
    .amount-box { text-align: center; margin: 20px 0; padding: 20px; background: #0b1322; border-radius: 8px; border: 1px solid #23354e; }
    .amount-val { font-size: 32px; font-weight: 800; color: #10b981; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }
    .label { color: #94a3b8; }
    .value { color: #f8fafc; font-weight: 600; text-align: right; }
    .btn { display: inline-block; width: 100%; box-sizing: border-box; background: #2563eb; color: #ffffff; text-align: center; padding: 14px 20px; font-size: 16px; font-weight: 600; border-radius: 8px; text-decoration: none; margin-top: 24px; }
    .footer { text-align: center; font-size: 12px; color: #64748b; padding: 20px; }
    .code { font-family: monospace; background: #0b111e; padding: 3px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>💰 Payment Received & Settled</h1>
      <div class="badge">Verified On-Chain</div>
    </div>
    <div class="content">
      <p style="margin-top: 0; font-size: 15px; color: #cbd5e1;">
        Great news <strong>${businessName}</strong>! A new crypto payment has been received and credited to your merchant ledger wallet.
      </p>

      <div class="amount-box">
        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">Total Received</div>
        <div class="amount-val">+${invoice.amount} ${invoice.currency}</div>
      </div>

      <div class="row">
        <span class="label">Invoice ID</span>
        <span class="value">${invoice.id}</span>
      </div>
      ${invoice.order_id ? `
      <div class="row">
        <span class="label">Order Reference</span>
        <span class="value">${invoice.order_id}</span>
      </div>` : ''}
      ${invoice.customer_email ? `
      <div class="row">
        <span class="label">Customer Email</span>
        <span class="value">${invoice.customer_email}</span>
      </div>` : ''}
      ${invoice.customer_name ? `
      <div class="row">
        <span class="label">Customer Name</span>
        <span class="value">${invoice.customer_name}</span>
      </div>` : ''}
      ${invoice.description ? `
      <div class="row">
        <span class="label">Item / Description</span>
        <span class="value">${invoice.description}</span>
      </div>` : ''}
      <div class="row">
        <span class="label">Target Ledger Wallet</span>
        <span class="value"><code class="code">${invoice.wallet_id || 'default'}</code></span>
      </div>
      <div class="row">
        <span class="label">Confirmations</span>
        <span class="value">${confirmations || 1}</span>
      </div>
      ${txid ? `
      <div class="row">
        <span class="label">Transaction Hash</span>
        <span class="value">
          ${explorerUrl ? `<a href="${explorerUrl}" target="_blank" style="color: #38bdf8; text-decoration: none;"><code class="code">${txid.slice(0, 16)}… ↗</code></a>` : `<code class="code">${txid}</code>`}
        </span>
      </div>` : ''}

      <a href="${dashboardUrl}" class="btn" target="_blank">Open Merchant Dashboard 📊</a>
    </div>
    <div class="footer">
      Payrail Automated Merchant Notification System
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * 3. Email to Customer (Payer) as Official Payment Receipt
 */
export function buildPaymentReceiptCustomerHtml({ invoice, merchant, txid, confirmations }) {
  const businessName = merchant?.business_name || 'Merchant';
  const explorerUrl = txid && txid.startsWith('0x') ? `https://bscscan.com/tx/${txid}` : null;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b111e; color: #f1f5f9; margin: 0; padding: 24px; }
    .card { max-width: 580px; margin: 0 auto; background: #131e31; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; }
    .header { background: #1e293b; padding: 24px; text-align: center; border-bottom: 2px solid #10b981; }
    .header h1 { margin: 0; font-size: 20px; color: #f8fafc; }
    .status-pill { display: inline-block; background: #064e3b; color: #34d399; font-weight: 700; font-size: 13px; padding: 4px 14px; border-radius: 12px; margin-top: 8px; }
    .content { padding: 28px; }
    .receipt-box { border: 1px dashed #334155; border-radius: 8px; padding: 20px; background: #0b1322; margin: 20px 0; }
    .amount-box { text-align: center; margin: 16px 0; }
    .amount-val { font-size: 30px; font-weight: 800; color: #10b981; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }
    .label { color: #94a3b8; }
    .value { color: #f8fafc; font-weight: 600; text-align: right; }
    .footer { text-align: center; font-size: 12px; color: #64748b; padding: 20px; }
    .code { font-family: monospace; background: #0f172a; padding: 3px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Payment Receipt</h1>
      <div class="status-pill">✓ Paid & Confirmed</div>
    </div>
    <div class="content">
      <p style="margin-top: 0; font-size: 15px; color: #cbd5e1;">
        Thank you! Your cryptocurrency payment to <strong>${businessName}</strong> has been successfully processed and verified on the blockchain.
      </p>

      <div class="receipt-box">
        <div class="amount-box">
          <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase;">Amount Paid</div>
          <div class="amount-val">${invoice.amount} ${invoice.currency}</div>
        </div>

        <div class="row">
          <span class="label">Merchant</span>
          <span class="value">${businessName}</span>
        </div>
        <div class="row">
          <span class="label">Receipt / Invoice ID</span>
          <span class="value">${invoice.id}</span>
        </div>
        ${invoice.order_id ? `
        <div class="row">
          <span class="label">Order ID</span>
          <span class="value">${invoice.order_id}</span>
        </div>` : ''}
        ${invoice.description ? `
        <div class="row">
          <span class="label">Item / Description</span>
          <span class="value">${invoice.description}</span>
        </div>` : ''}
        <div class="row">
          <span class="label">Network</span>
          <span class="value">${invoice.currency.includes('BSC') ? 'BNB Smart Chain (BSC Mainnet)' : invoice.currency}</span>
        </div>
        <div class="row">
          <span class="label">Date</span>
          <span class="value">${new Date().toUTCString()}</span>
        </div>
        ${txid ? `
        <div class="row">
          <span class="label">Blockchain Transaction</span>
          <span class="value">
            ${explorerUrl ? `<a href="${explorerUrl}" target="_blank" style="color: #38bdf8; text-decoration: none;"><code class="code">${txid.slice(0, 16)}… ↗</code></a>` : `<code class="code">${txid}</code>`}
          </span>
        </div>` : ''}
      </div>

      <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">
        Please keep this receipt for your records. If you have any inquiries regarding your purchase, please contact <strong>${businessName}</strong> directly with your Order Reference.
      </p>
    </div>
    <div class="footer">
      Generated securely by Payrail Crypto Payment Gateway
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Dispatcher: Notify Merchant & Customer on payment receipt/settlement
 */
export async function notifyPaymentReceived({ invoice, txid, confirmations }) {
  if (!invoice) return;

  // 1. Fetch merchant details
  let merchant = null;
  if (invoice.merchant_id) {
    const res = await query('SELECT * FROM merchants WHERE id = $1', [invoice.merchant_id]);
    merchant = res.rows[0] || null;
  }

  // Fallback: if no specific merchant, find super admin email
  if (!merchant) {
    const adminRes = await query("SELECT * FROM merchants WHERE role = 'super_admin' LIMIT 1");
    merchant = adminRes.rows[0] || { email: 'admin@gateway.local', business_name: 'Platform Treasury' };
  }

  const results = {};

  // 2. Email Business Owner (Merchant)
  if (merchant && merchant.email) {
    const merchantHtml = buildPaymentReceivedMerchantHtml({
      invoice,
      merchant,
      txid,
      confirmations,
    });
    const subject = `💰 Payment Received: ${invoice.amount} ${invoice.currency} (Order #${invoice.order_id || invoice.id.slice(0, 8)})`;

    results.merchantEmail = await sendEmail({
      to: merchant.email,
      subject,
      html: merchantHtml,
      recipientType: 'merchant',
      template: 'payment_received_merchant',
      invoiceId: invoice.id,
      merchantId: merchant.id,
    });
  }

  // 3. Email Customer (Payer) if email is provided
  if (invoice.customer_email) {
    const customerHtml = buildPaymentReceiptCustomerHtml({
      invoice,
      merchant,
      txid,
      confirmations,
    });
    const subject = `Receipt for Payment to ${merchant?.business_name || 'Merchant'} (Invoice #${invoice.id.slice(0, 8)})`;

    results.customerEmail = await sendEmail({
      to: invoice.customer_email,
      subject,
      html: customerHtml,
      recipientType: 'customer',
      template: 'payment_receipt_customer',
      invoiceId: invoice.id,
      merchantId: merchant ? merchant.id : null,
    });

    // Mark receipt_email_sent flag on invoice
    await query('UPDATE invoices SET receipt_email_sent = 1 WHERE id = $1', [invoice.id]);
  }

  return results;
}

/**
 * Dispatcher: Notify Customer when invoice is first created
 */
export async function notifyInvoiceCreated({ invoice, merchant }) {
  const customerEmail = invoice?.customer_email || invoice?.customerEmail;
  if (!invoice || !customerEmail) return null;

  const checkoutUrl = `${config.publicUrl}/?invoiceId=${invoice.id}`;
  const html = buildInvoiceCreatedHtml({ invoice, merchant, checkoutUrl });
  const orderRef = invoice.order_id || invoice.orderId || invoice.id.slice(0, 8);
  const subject = `Invoice #${orderRef} from ${merchant?.business_name || 'Payrail Merchant'}`;

  return await sendEmail({
    to: customerEmail,
    subject,
    html,
    recipientType: 'customer',
    template: 'invoice_created',
    invoiceId: invoice.id,
    merchantId: merchant ? merchant.id : null,
  });
}

/**
 * Builds HTML template for OTP verification emails
 */
export function buildOtpEmailHtml({ otp, purpose = 'signup', recipientName = '' }) {
  const isSignup = purpose === 'signup';
  const title = isSignup ? 'Confirm Your Registration' : 'Account Security Verification';
  const subtitle = isSignup
    ? 'Verify your email address to complete your Payrail Merchant account setup.'
    : 'A sign-in attempt was initiated for your Payrail Merchant account.';
  const note = isSignup
    ? 'Enter this 6-digit code in your browser to verify your identity and activate your account.'
    : 'Enter this 6-digit one-time code to complete your login.';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b111e; color: #f1f5f9; margin: 0; padding: 24px; }
    .card { max-width: 520px; margin: 0 auto; background: #131e31; border: 1px solid #1e293b; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { background: #1e293b; padding: 26px; text-align: center; border-bottom: 2px solid #38bdf8; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; color: #f8fafc; letter-spacing: -0.3px; }
    .badge { display: inline-block; background: #0c4a6e; color: #38bdf8; font-weight: 700; font-size: 12px; padding: 4px 12px; border-radius: 20px; margin-top: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .content { padding: 32px 28px; text-align: center; }
    .greeting { font-size: 16px; color: #cbd5e1; margin-bottom: 12px; text-align: left; }
    .msg { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; text-align: left; }
    .otp-container { background: #0b1322; border: 2px dashed #38bdf8; border-radius: 12px; padding: 20px 16px; margin: 24px 0; text-align: center; }
    .otp-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; font-weight: 600; }
    .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #38bdf8; text-indent: 10px; }
    .expiry { font-size: 12px; color: #f59e0b; margin-top: 10px; font-weight: 600; }
    .warning-box { background: #1e1b2e; border-left: 3px solid #f43f5e; padding: 14px 16px; border-radius: 6px; text-align: left; font-size: 13px; color: #cbd5e1; line-height: 1.5; margin: 24px 0 12px; }
    .footer { text-align: center; font-size: 12px; color: #64748b; padding: 20px; border-top: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Payrail Gateway</h1>
      <div class="badge">Security Verification</div>
    </div>
    <div class="content">
      ${recipientName ? `<div class="greeting">Hello <strong>${recipientName}</strong>,</div>` : '<div class="greeting">Hello,</div>'}
      <div class="msg">
        ${subtitle}<br>${note}
      </div>

      <div class="otp-container">
        <div class="otp-label">Your 6-Digit One-Time Security Code</div>
        <div class="otp-code">${otp}</div>
        <div class="expiry">⏱ Valid for 10 minutes only</div>
      </div>

      <div class="warning-box">
        <strong>Security Tip:</strong> Never share this verification code with anyone, including platform administrators. Payrail staff will never ask for your code.
      </div>
    </div>
    <div class="footer">
      Payrail Crypto Payment Gateway &bull; High Security Infrastructure<br>
      If you did not make this request, you can safely disregard this email.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Dispatches an OTP verification code via configured email transport
 */
export async function sendOtpEmail({ to, otp, purpose = 'signup', recipientName = '' }) {
  const isSignup = purpose === 'signup';
  const subject = isSignup
    ? `🔐 Payrail: Your Verification Code is ${otp}`
    : `🔐 Payrail: Your Sign In Security Code is ${otp}`;
  const html = buildOtpEmailHtml({ otp, purpose, recipientName });
  const text = `Your Payrail ${isSignup ? 'registration' : 'login'} verification code is: ${otp}. It will expire in 10 minutes. Never share this code with anyone.`;

  return await sendEmail({
    to,
    subject,
    html,
    text,
    recipientType: 'merchant',
    template: `otp_${purpose}`,
  });
}

/**
 * Query email audit logs
 */
export async function getEmailLogs({ limit = 50, merchantId = null, invoiceId = null } = {}) {
  let q = 'SELECT * FROM email_logs';
  const params = [];
  const where = [];

  if (merchantId) {
    params.push(merchantId);
    where.push(`merchant_id = $${params.length}`);
  }
  if (invoiceId) {
    params.push(invoiceId);
    where.push(`invoice_id = $${params.length}`);
  }

  if (where.length > 0) {
    q += ' WHERE ' + where.join(' AND ');
  }

  params.push(limit);
  q += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const res = await query(q, params);
  return res.rows;
}
