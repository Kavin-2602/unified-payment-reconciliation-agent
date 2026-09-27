-- ============================================================
-- Unified Stream · Supabase Database Schema
-- Run this in your Supabase SQL editor (Dashboard > SQL Editor)
-- ============================================================

-- Enable UUID extension (already enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE 1: dodo_payments
-- Source: Dodo Payments webhook events
-- ============================================================
CREATE TABLE IF NOT EXISTS dodo_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      TEXT UNIQUE NOT NULL,       -- Dodo's unique payment ID
  merchant_order_id TEXT,                     -- Your internal order ID
  amount          NUMERIC(12, 2) NOT NULL,    -- Amount in major currency unit (e.g., 1500.00)
  currency        TEXT NOT NULL DEFAULT 'INR',
  status          TEXT NOT NULL,              -- 'succeeded' | 'failed' | 'refunded'
  payment_method  TEXT,                       -- 'upi' | 'card' | 'netbanking' | etc.
  customer_email  TEXT,
  event_type      TEXT,                       -- 'payment.succeeded' etc.
  raw_payload     JSONB,                      -- Full event payload for debugging
  received_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dodo_payments_payment_id ON dodo_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_dodo_payments_merchant_order_id ON dodo_payments(merchant_order_id);
CREATE INDEX IF NOT EXISTS idx_dodo_payments_received_at ON dodo_payments(received_at DESC);

-- ============================================================
-- TABLE 2: settlement_transactions
-- Source: Uploaded CSV files (UPI/Card/Cash/Bank)
-- ============================================================
CREATE TABLE IF NOT EXISTS settlement_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id  TEXT NOT NULL,              -- Maps to Dodo payment_id for matching
  merchant_order_id TEXT,
  amount          NUMERIC(12, 2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'INR',
  payment_method  TEXT,                       -- 'upi' | 'card' | 'cash' | 'bank'
  status          TEXT,                       -- 'settled' | 'pending' | 'failed'
  settlement_date DATE,
  source          TEXT NOT NULL,              -- 'upi' | 'card' | 'cash' | 'bank'
  raw_row         JSONB,                      -- Original CSV row
  row_index       INT,                        -- Row number in source CSV (for debugging)
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(transaction_id, source)              -- Same txn_id can appear in multiple sources
);

CREATE INDEX IF NOT EXISTS idx_settlement_transaction_id ON settlement_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_settlement_source ON settlement_transactions(source);

-- ============================================================
-- TABLE 3: reconciliation_runs
-- One row per triggered reconciliation run
-- ============================================================
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          TEXT UNIQUE NOT NULL,       -- e.g., "run_1727424000000"
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'
  total           INT DEFAULT 0,
  matched         INT DEFAULT 0,
  mismatched      INT DEFAULT 0,
  missing         INT DEFAULT 0,
  duplicate       INT DEFAULT 0,
  total_amount_discrepancy NUMERIC(14, 2) DEFAULT 0,
  currency        TEXT DEFAULT 'INR',
  triggered_by    TEXT DEFAULT 'manual',      -- 'manual' | 'webhook' | 'scheduled'
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON reconciliation_runs(created_at DESC);

-- ============================================================
-- TABLE 4: reconciliation_results
-- One row per transaction per run
-- ============================================================
CREATE TABLE IF NOT EXISTS reconciliation_results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          TEXT NOT NULL REFERENCES reconciliation_runs(run_id) ON DELETE CASCADE,
  transaction_id  TEXT NOT NULL,
  status          TEXT NOT NULL,              -- 'MATCHED' | 'MISMATCHED' | 'MISSING' | 'DUPLICATE'
  webhook_amount  NUMERIC(12, 2),
  settlement_amount NUMERIC(12, 2),
  amount_delta    NUMERIC(12, 2),             -- webhook_amount - settlement_amount
  payment_method  TEXT,
  settlement_source TEXT,
  discrepancy_details JSONB,                  -- { reason: '...', field: '...', expected: ..., actual: ... }
  ai_explanation  TEXT,                       -- Gemini NL explanation (populated in Phase 3)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_run_id ON reconciliation_results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_transaction_id ON reconciliation_results(transaction_id);
CREATE INDEX IF NOT EXISTS idx_results_status ON reconciliation_results(status);

-- ============================================================
-- TABLE 5: reconciliation_reports
-- AI-generated natural-language report per run
-- ============================================================
CREATE TABLE IF NOT EXISTS reconciliation_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          TEXT NOT NULL REFERENCES reconciliation_runs(run_id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,              -- Gemini NL summary
  generated_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_run_id ON reconciliation_reports(run_id);
CREATE INDEX IF NOT EXISTS idx_reports_generated_at ON reconciliation_reports(generated_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Supabase enables RLS by default. For the hackathon demo,
-- we use service role key from backend (bypasses RLS).
-- If you want to expose data to frontend directly, add policies.
-- ============================================================

-- Example: Allow anon read on results (optional, only if frontend queries Supabase directly)
-- ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Public read" ON reconciliation_results FOR SELECT USING (true);

-- ============================================================
-- SAMPLE DATA (optional — for testing without CSV upload)
-- Uncomment to insert test rows
-- ============================================================

/*
-- Sample Dodo payment events
INSERT INTO dodo_payments (payment_id, amount, currency, status, payment_method, event_type, received_at)
VALUES
  ('pay_matched_001',    1500.00, 'INR', 'succeeded', 'upi',  'payment.succeeded', NOW()),
  ('pay_matched_002',    2200.00, 'INR', 'succeeded', 'card', 'payment.succeeded', NOW()),
  ('pay_mismatch_001',   999.00,  'INR', 'succeeded', 'upi',  'payment.succeeded', NOW()),
  ('pay_missing_001',    750.00,  'INR', 'succeeded', 'card', 'payment.succeeded', NOW()),
  ('pay_duplicate_001',  500.00,  'INR', 'succeeded', 'upi',  'payment.succeeded', NOW());

-- Sample settlement rows
INSERT INTO settlement_transactions (transaction_id, amount, currency, payment_method, status, settlement_date, source)
VALUES
  ('pay_matched_001',    1500.00, 'INR', 'upi',  'settled', CURRENT_DATE, 'upi'),
  ('pay_matched_002',    2200.00, 'INR', 'card', 'settled', CURRENT_DATE, 'card'),
  ('pay_mismatch_001',   1099.00, 'INR', 'upi',  'settled', CURRENT_DATE, 'upi'),
  -- pay_missing_001 intentionally absent (MISSING scenario)
  ('pay_duplicate_001',  500.00,  'INR', 'upi',  'settled', CURRENT_DATE, 'upi'),
  ('pay_duplicate_001',  500.00,  'INR', 'upi',  'settled', CURRENT_DATE, 'upi');  -- DUPLICATE
*/
