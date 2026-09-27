# Dodo Payments Integration Guide

> **Unified Stream · EmberGround AI Hackathon 2026**

This document covers connecting Dodo Payments test-mode webhooks to the
Unified Stream backend, exposing the endpoint via n8n, and a full fallback
plan so the demo works without a live Dodo connection.

---

## 1. Get Your Dodo Test-Mode Webhook Secret

1. Log in to [Dodo Payments Dashboard](https://app.dodopayments.com)
2. Switch to **Test Mode** (toggle in the top-right)
3. Navigate to **Developer → Webhooks → Add Endpoint**
4. Enter your endpoint URL (see Section 3 for the URL to use)
5. Select events to subscribe to:
   - ✅ `payment.succeeded`
   - ✅ `payment.failed`
   - ✅ `payment.refunded`
   - ✅ `payment.cancelled`
6. Click **Create** — Dodo shows a **Signing Secret**
7. Copy the secret (starts with `whsec_...`)
8. Add it to `backend/.env`:

```env
DODO_WEBHOOK_SECRET=whsec_your_actual_secret_here
```

> **Signing secret format:** Dodo uses the
> [Standard Webhooks](https://standardwebhooks.com/) spec.
> The secret is base64-encoded with a `whsec_` prefix.

---

## 2. Register the Webhook URL

### Option A — via n8n (recommended for hackathon demo)

1. Start n8n locally:
   ```bash
   npx n8n
   # or if installed globally:
   n8n start
   ```
2. Import `n8n/workflow.json` (n8n UI → Workflows → Import)
3. **Activate** the workflow — note the webhook URL shown:
   ```
   https://<your-n8n-host>/webhook/dodo-webhook
   ```
4. Expose n8n to the internet (Dodo needs a public URL):
   ```bash
   # Using ngrok:
   ngrok http 5678
   # → gives you: https://abc123.ngrok-free.app

   # Your full webhook URL:
   # https://abc123.ngrok-free.app/webhook/dodo-webhook
   ```
5. Register that URL in Dodo Dashboard → Developer → Webhooks

### Option B — direct backend (no n8n)

Expose the backend directly:
```bash
ngrok http 4000
# → https://abc123.ngrok-free.app

# Register in Dodo: https://abc123.ngrok-free.app/webhooks/dodo
```

The backend endpoint `POST /webhooks/dodo` handles the webhook natively.

---

## 3. Webhook Signature Verification

### Current Status: ⚠️ Skipped if `DODO_WEBHOOK_SECRET` is unset

The backend implements full Standard Webhooks signature verification when
`DODO_WEBHOOK_SECRET` is set. For the hackathon demo, if the env var is
**not set**, the backend logs a warning and accepts all requests:

```
⚠️  DODO_WEBHOOK_SECRET not set — skipping signature verification (dev/hackathon mode)
```

**This is an intentional shortcut for time-constrained hackathon builds.**
In production, always set the secret.

### How verification works (for reference)

Dodo sends three Standard Webhooks headers:

| Header | Example Value |
|---|---|
| `webhook-id` | `msg_2abc3def` |
| `webhook-timestamp` | `1727424000` (Unix seconds) |
| `webhook-signature` | `v1,abc123...` (space-separated if multiple) |

The backend verifies:
```
toSign = `${webhook-id}.${webhook-timestamp}.${raw_body}`
secret = base64decode(DODO_WEBHOOK_SECRET.replace('whsec_', ''))
expected = base64(HMAC-SHA256(secret, toSign))
# compare with the v1,<base64> value in webhook-signature
```

Replay attack protection: events older than 5 minutes are rejected.

---

## 4. Dodo Payload Shape — Confirmed vs Assumed

> ### ⚠️ RISK ITEM #1 — Payload shape partially unconfirmed

The Dodo webhook event shape used in `backend/src/routes/webhook.js` is
based on the [official integration guide](https://docs.dodopayments.com/developer-resources/integration-guide.md)
and the Dodo Payments JavaScript SDK types.

### What is confirmed ✅

- Event envelope: `{ type: "payment.succeeded", data: { ... } }`
- Headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`
  (Standard Webhooks spec — confirmed in docs)
- `data.payment_id` — unique payment identifier
- `data.status` — `"succeeded"` | `"failed"` | etc.
- `data.currency` — ISO 4217 currency code
- `data.customer` — customer object `{ email, name, ... }`
- `data.payment_method.type` — `"upi"` | `"card"` | etc.

### What is assumed / needs live verification ⚠️

| Field | Assumed path | Risk |
|---|---|---|
| Amount | `data.total_amount` (minor units — paise) | **Not confirmed.** Could be `data.amount` or already in major units. |
| Merchant order ID | `data.merchant_order_id` | Field name not confirmed in docs |
| Payment method | `data.payment_method.type` | Could be a flat string, not nested |

### How the backend handles this

`webhook.js` has a resilient normalizer that falls back:
```js
amount = p.total_amount ?? p.amount  // tries both field names
amount = amount / 100                // assumes minor units (paise)
payment_method = p.payment_method?.type || p.payment_method || 'unknown'
```

**To confirm the actual payload shape:** trigger a test payment in Dodo
test mode and check the raw webhook body in n8n's execution log or the
backend terminal output.

---

## 5. Fallback Plan — Demo Without Live Dodo Connection

Use this if you can't get the live Dodo webhook working during the hackathon.

### Step 1 — Seed sample data (already done)

```bash
cd backend
npm run seed:data
# → 22 dodo_payments + 19 settlement_transactions inserted
```

### Step 2 — Simulate a Dodo webhook event via curl

```bash
# POST a synthetic payment.succeeded event directly to the backend
# No signature required (DODO_WEBHOOK_SECRET not set = skip verification)

curl -X POST http://localhost:4000/webhooks/dodo \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payment.succeeded",
    "data": {
      "payment_id": "pay_demo_live_001",
      "merchant_order_id": "ORD-DEMO-001",
      "total_amount": 150000,
      "currency": "INR",
      "status": "succeeded",
      "payment_method": { "type": "upi" },
      "customer": {
        "email": "vendor@example.com",
        "name": "Test Vendor"
      }
    }
  }'
```

Expected response:
```json
{ "received": true, "processed": true, "payment_id": "pay_demo_live_001" }
```

### Step 3 — Trigger reconciliation

```bash
curl -X POST http://localhost:4000/reconcile/run
```

Expected response (200 OK):
```json
{
  "run_id": "run_...",
  "status": "completed",
  "summary": {
    "total": 24,
    "matched": 14,
    "mismatched": 4,
    "missing": 5,
    "duplicate": 0,
    "total_amount_discrepancy": 459
  }
}
```

### Step 4 — View results in dashboard

Open [http://localhost:5173](http://localhost:5173) — the dashboard will
show the new run immediately.

### Step 5 — Simulate a mismatched payment (for the demo story)

```bash
# Insert a payment where the webhook amount (₹1000) will differ
# from a settlement CSV amount — creates a MISMATCHED result

curl -X POST http://localhost:4000/webhooks/dodo \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payment.succeeded",
    "data": {
      "payment_id": "pay_demo_mismatch",
      "merchant_order_id": "ORD-DEMO-999",
      "total_amount": 100000,
      "currency": "INR",
      "status": "succeeded",
      "payment_method": { "type": "card" },
      "customer": { "email": "demo@hackathon.dev", "name": "Demo User" }
    }
  }'

# Then trigger reconciliation to see it flagged
curl -X POST http://localhost:4000/reconcile/run
```

---

## 6. Full Demo Script

For the hackathon presentation, follow this sequence:

```bash
# 1. Start services
cd backend  && npm run dev   # terminal 1 — port 4000
cd frontend && npm run dev   # terminal 2 — port 5173

# 2. Seed the database (if not already done)
cd backend && npm run seed:data

# 3. Simulate a live Dodo payment arriving
curl -X POST http://localhost:4000/webhooks/dodo \
  -H "Content-Type: application/json" \
  -d '{ "type": "payment.succeeded", "data": { "payment_id": "pay_demo_live_002", "total_amount": 299900, "currency": "INR", "status": "succeeded", "payment_method": { "type": "upi" }, "customer": { "name": "MSME Vendor" } } }'

# 4. Run reconciliation
curl -X POST http://localhost:4000/reconcile/run

# 5. Open dashboard — http://localhost:5173
#    Click a MISMATCHED row → Explain › → Gemini explanation loads
#    Click "AI Report" → Gemini full report loads
```

---

## 7. n8n Workflow Overview

The workflow at `n8n/workflow.json` has 5 nodes:

```
[Dodo Webhook Trigger]
       │
       ▼
[Normalize Dodo Payload]   ← extracts headers, surfaces event type
       │
       ▼
[POST /webhooks/dodo]      ← forwards to backend with signature headers
       │
       ▼
[Was Payment Stored?]      ← IF: backend returned processed: true
    ┌──┴──────────────────────────────┐
    │                                 │
    ▼                                 ▼
[POST /reconcile/run]       [Return 200 to Dodo]
    │
    ▼
[Return 200 to Dodo]
```

**Import instructions:**
1. n8n UI → Workflows → ⊕ → Import from file
2. Select `n8n/workflow.json`
3. Update the HTTP Request URLs if backend is not on `localhost:4000`
4. Click **Activate** (toggle in top-right)

---

## 8. Environment Variables Summary

```env
# backend/.env

# Required for Supabase
SUPABASE_URL=https://bfvnmnumehzxasetshmb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>

# Required for Gemini explanations
GEMINI_API_KEY=<your_google_ai_studio_key>
GEMINI_MODEL=gemini-3.8-flash

# Optional — enables webhook signature verification
# Get from: Dodo Dashboard → Developer → Webhooks → Signing Secret
DODO_WEBHOOK_SECRET=whsec_...

# Server
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```
