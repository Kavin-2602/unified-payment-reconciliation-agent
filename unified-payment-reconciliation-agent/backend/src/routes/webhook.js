/**
 * backend/src/routes/webhook.js
 *
 * Receives Dodo Payments webhook events (test-mode).
 *
 * Dodo Payments uses the Standard Webhooks spec (https://standardwebhooks.com/).
 * Headers: webhook-id, webhook-timestamp, webhook-signature
 *
 * Signature algorithm:
 *   msgId      = webhook-id header
 *   msgTs      = webhook-timestamp header
 *   body       = raw request body (Buffer)
 *   toSign     = `${msgId}.${msgTs}.${body}`
 *   secret     = base64-decode(DODO_WEBHOOK_SECRET after stripping "whsec_" prefix)
 *   signature  = base64( HMAC-SHA256( secret, toSign ) )
 *   compare with each "v1,<base64>" entry in the webhook-signature header
 *
 * ⚠️  HACKATHON NOTE: Signature verification is implemented but SKIPPED if
 *   DODO_WEBHOOK_SECRET is not set. This lets the curl fallback work without
 *   a real Dodo account. Set the env var in production.
 *
 * Live columns in dodo_payments:
 *   payment_id, amount, currency, status, payment_method,
 *   merchant_order_id, customer
 */

'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { supabase } = require('../db/supabaseClient');

// ── Signature verification (Standard Webhooks) ────────────────────────────────

function verifyDodoSignature(rawBody, headers) {
  const webhookSecret = process.env.DODO_WEBHOOK_SECRET;

  // Treat placeholder / missing secret as "not configured" — skip verification
  const PLACEHOLDER = ['your_dodo', 'placeholder', 'change_me', 'whsec_your'];
  if (!webhookSecret || PLACEHOLDER.some((p) => webhookSecret.includes(p))) {
    console.warn('⚠️  DODO_WEBHOOK_SECRET not configured — skipping signature verification (dev/hackathon mode)');
    return true;
  }

  // Standard Webhooks header names (Dodo's actual spec)
  const msgId  = headers['webhook-id']        || headers['svix-id'];        // fallback for older docs
  const msgTs  = headers['webhook-timestamp'] || headers['svix-timestamp'];
  const msgSig = headers['webhook-signature'] || headers['svix-signature'];

  if (!msgId || !msgTs || !msgSig) {
    console.warn('⚠️  Missing webhook headers (webhook-id / webhook-timestamp / webhook-signature)');
    return false;
  }

  // Replay attack protection — reject events older than 5 minutes
  const tsMs = parseInt(msgTs, 10) * 1000;
  if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    console.warn('⚠️  Webhook timestamp too old (possible replay attack)');
    return false;
  }

  const toSign      = `${msgId}.${msgTs}.${rawBody.toString()}`;
  const secretBytes = Buffer.from(webhookSecret.replace('whsec_', ''), 'base64');
  const expected    = crypto
    .createHmac('sha256', secretBytes)
    .update(toSign)
    .digest('base64');

  // webhook-signature may contain multiple space-separated "v1,<base64>" entries
  const sigs = msgSig.split(' ');
  return sigs.some((sig) => {
    const val = sig.startsWith('v1,') ? sig.slice(3) : sig;
    return crypto.timingSafeEqual(Buffer.from(val), Buffer.from(expected));
  });
}

// ── Normalize Dodo payload → dodo_payments columns ────────────────────────────

function normalizePayment(event) {
  const p = event.data || event;   // handle both wrapped and bare payloads

  return {
    payment_id:        p.payment_id,
    merchant_order_id: p.merchant_order_id || null,
    // Dodo sends amounts in minor units (paise for INR) — convert to major units
    amount:            typeof p.total_amount === 'number'
                         ? p.total_amount / 100
                         : (typeof p.amount === 'number' ? p.amount / 100 : null),
    currency:          (p.currency || 'INR').toUpperCase(),
    status:            p.status || 'succeeded',
    payment_method:    p.payment_method?.type
                       || p.payment_method
                       || 'unknown',
    customer:          p.customer || null,    // JSONB — store the full customer object
  };
}

// ── POST /webhooks/dodo ───────────────────────────────────────────────────────

router.post('/dodo', async (req, res) => {
  const rawBody = req.body;   // express.raw() → Buffer

  // 1. Verify signature
  if (!verifyDodoSignature(rawBody, req.headers)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // 2. Parse JSON
  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // 3. Filter to reconciliation-relevant event types
  const RELEVANT_EVENTS = [
    'payment.succeeded',
    'payment.failed',
    'payment.refunded',
    'payment.cancelled',
  ];

  if (!RELEVANT_EVENTS.includes(event.type)) {
    console.log(`📭 Dodo webhook ignored: ${event.type}`);
    return res.json({ received: true, processed: false, reason: 'event_type_ignored' });
  }

  // 4. Normalize → live column names
  const row = normalizePayment(event);

  if (!row.payment_id) {
    console.error('Webhook payload missing payment_id:', event);
    return res.status(422).json({ error: 'Missing payment_id in payload' });
  }

  // 5. Upsert into dodo_payments (idempotent — Dodo retries on non-2xx)
  const { error } = await supabase
    .from('dodo_payments')
    .upsert(row, { onConflict: 'payment_id' });

  if (error) {
    console.error('dodo_payments upsert error:', error.message, error.code);
    return res.status(500).json({ error: 'Failed to store payment event', detail: error.message });
  }

  console.log(`📥 Dodo webhook processed: ${event.type} | ${row.payment_id} | ₹${row.amount}`);
  res.json({ received: true, processed: true, payment_id: row.payment_id });
});

module.exports = router;
