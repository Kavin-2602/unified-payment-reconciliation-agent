# 🔁 Unified Stream — AI-Powered MSME Payment Reconciliation Agent

> **EmberGround AI Hackathon 2026 · Bangalore**

An autonomous AI agent that reconciles MSME payments across sources (Dodo Payments webhook + simulated UPI/Card/Cash/Bank CSVs), classifies each transaction, explains discrepancies in natural language, and generates a reconciliation report.

---

## 🏗️ Architecture

```
Dodo Payments (webhook) ──►┐
                            ├──► n8n Orchestrator ──► Backend (port 4000)
CSV (UPI/Card/Cash/Bank) ──►┘                              │
                                                     ┌──────┴──────┐
                                                     │             │
                                              Reconciliation   AI Agent
                                                 Engine        (Gemini)
                                              (deterministic)  (NL only)
                                                     │             │
                                                     └──────┬──────┘
                                                            │
                                                    PostgreSQL (Supabase)
                                                            │
                                                    React Dashboard (port 5173)
```

## 📂 Repo Structure

```
unified-payment-reconciliation-agent/
├── frontend/          # React dashboard (Vite) — port 5173
├── backend/           # Node.js Express API + Gemini agent — port 4000
│   └── src/
│       ├── agent/     # Gemini client + prompt builders (merged from agent/)
│       └── routes/    # webhook, upload, reconcile, agent, health
├── agent/             # ⚠️  Reference only — no longer a running service
├── n8n/               # n8n workflow JSON exports
├── data/
│   ├── samples/       # Sample CSVs with all 4 transaction states
│   └── schemas/       # DB schema SQL + data schema docs
└── docs/              # Architecture, API docs, hackathon notes
```

> **Note:** The `agent/` directory is kept for reference. Its logic now lives in
> `backend/src/agent/` and `backend/src/routes/agent.js`. Do not run it as a service.

## 🔑 Transaction Status Types

| Status | Meaning |
|--------|---------|
| `MATCHED` | Webhook payment ↔ CSV settlement match exactly |
| `MISMATCHED` | Same transaction ID but amount/date differs |
| `MISSING` | Present in webhook but absent in CSV (or vice versa) |
| `DUPLICATE` | Same transaction ID appears more than once |

## ⚠️ Core Rule

> **Matching, classification, and amount comparison = deterministic code only.**
> The LLM (Gemini) is used ONLY for:
> 1. Explaining *why* a discrepancy occurred (natural language)
> 2. Writing a natural-language summary of the reconciliation run

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- npm 10+
- Supabase project (URL + service role key)
- Gemini API key

> **n8n is optional for local development** — see [Testing without n8n](#-testing-without-n8n) below.

### 1. Install dependencies

```bash
# Backend (includes Gemini — only TWO services needed)
cd backend && npm install

# Frontend
cd frontend && npm install
```

### 2. Environment variables

```bash
# backend/.env
cp backend/.env.example backend/.env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DODO_WEBHOOK_SECRET, GEMINI_API_KEY

# frontend/.env.local
cp frontend/.env.example frontend/.env.local
# Fill in: VITE_API_BASE_URL (default: http://localhost:4000)
```

### 3. Run the Supabase schema

Go to **Supabase Dashboard → SQL Editor** and run [`data/schemas/supabase_schema.sql`](data/schemas/supabase_schema.sql).

### 4. Start services (only TWO terminals needed)

```bash
# Terminal 1 — Backend API + AI agent (port 4000)
cd backend && npm run dev

# Terminal 2 — React dashboard (port 5173)
cd frontend && npm run dev
```

---

## 🧪 Testing without n8n

> **n8n is only needed on hackathon day for the live Dodo Payments webhook path.**
> For local development and testing, use `curl` directly.

### Simulate a Dodo payment webhook

```bash
# POST a payment.succeeded event directly to the backend
# (signature verification is skipped when DODO_WEBHOOK_SECRET is not set)
curl -X POST http://localhost:4000/webhooks/dodo \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payment.succeeded",
    "data": {
      "payment_id": "pay_test_001",
      "merchant_order_id": "ORD-TEST-001",
      "total_amount": 1500.00,
      "currency": "INR",
      "status": "succeeded",
      "payment_method": { "type": "upi" },
      "customer": { "email": "test@example.com" }
    }
  }'
```

### Upload a settlement CSV

```bash
curl -X POST http://localhost:4000/upload/csv \
  -F "file=@data/samples/upi_settlement.csv" \
  -F "source=upi"
```

### Trigger a reconciliation run

```bash
curl -X POST http://localhost:4000/reconcile/run
```

### Fetch reconciliation results

```bash
curl http://localhost:4000/reconcile/results
```

### Test the AI agent (explain a discrepancy)

```bash
curl -X POST http://localhost:4000/agent/explain \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "pay_test_001",
    "status": "MISMATCHED",
    "webhook_amount": 1500.00,
    "settlement_amount": 1400.00,
    "payment_method": "upi",
    "discrepancy_details": { "delta": -100 }
  }'
```

### Test the AI agent (summarize a run)

```bash
curl -X POST http://localhost:4000/agent/summarize \
  -H "Content-Type: application/json" \
  -d '{
    "run_id": "run_test_001",
    "total": 10,
    "matched": 7,
    "mismatched": 2,
    "missing": 1,
    "duplicate": 0,
    "total_amount_discrepancy": 300,
    "currency": "INR",
    "mismatched_transactions": [
      { "transaction_id": "pay_test_001", "webhook_amount": 1500, "settlement_amount": 1400 }
    ]
  }'
```

### Fetch results with AI explanations attached

```bash
# ?explain=true generates a Gemini explanation for each MISMATCHED/MISSING/DUPLICATE row.
# Combine with ?status= and ?limit= to avoid burning API quota during dev.
curl "http://localhost:4000/reconcile/results?explain=true&status=MISMATCHED&limit=5"
```

### Generate a natural-language run report

```bash
# Replace RUN_ID with the run_id returned by POST /reconcile/run.
# First call generates + persists the report; subsequent calls return the cache.
curl http://localhost:4000/reconcile/runs/RUN_ID/report

# Or fetch the latest report across all runs:
curl http://localhost:4000/reconcile/report
```

### Health check

```bash
curl http://localhost:4000/health
```

---

## 🔄 Quick Demo Reset

If something breaks mid-rehearsal, run these commands to reset to clean demo data:

### Reset the database
```bash
cd backend && npm run seed:data
# → Upserts 22 dodo_payments + 19 settlement_transactions
# → Idempotent — safe to run multiple times
```

### Live Dodo Simulation (The "Money Moment")
```bash
# 1. Simulate a Dodo webhook arriving (150000 paise = ₹1500)
curl -X POST http://localhost:4000/webhooks/dodo \
  -H "Content-Type: application/json" \
  -d '{"type":"payment.succeeded","data":{"payment_id":"pay_demo_001","total_amount":150000,"currency":"INR","status":"succeeded","payment_method":{"type":"upi"},"customer":{"name":"Demo Vendor"}}}'

# 2. Run reconciliation engine
curl -X POST http://localhost:4000/reconcile/run

# 3. View reconciliation runs summary
curl http://localhost:4000/reconcile/runs
```

> **Note:** `total_amount: 150000` is in paise and is automatically converted to `₹1500.00` by `webhook.js`. `pay_demo_001` will be classified as **MISSING** (present in Dodo payments but not in settlement batches), illustrating real-time discrepancy detection.

---

## 📡 API Reference

### Backend (port 4000)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/dodo` | Receive Dodo Payments webhook event |
| `POST` | `/upload/csv` | Upload settlement CSV (`source`: upi/card/cash/bank) |
| `POST` | `/reconcile/run` | Trigger deterministic reconciliation engine |
| `GET` | `/reconcile/runs` | List all runs (newest first) |
| `GET` | `/reconcile/runs/:runId` | Get a specific run's aggregate summary |
| `GET` | `/reconcile/runs/:runId/report` | Generate (or return cached) NL run report |
| `GET` | `/reconcile/results` | Fetch results (`?run_id=` `?status=` `?limit=` `?explain=true`) |
| `GET` | `/reconcile/results/:id` | Fetch single result (`?explain=true` for on-demand explanation) |
| `GET` | `/reconcile/report` | Get latest NL report across all runs |
| `POST` | `/agent/explain` | NL explanation for a single discrepancy (direct) |
| `POST` | `/agent/summarize` | NL summary of a full reconciliation run (direct) |
| `GET` | `/health` | Health check |

---

*Built for EmberGround AI Hackathon 2026 · Bangalore*
