/**
 * backend/scripts/seed-sample-data.js
 *
 * One-time seed: reads the 4 sample CSVs from data/samples/ and inserts
 * rows directly into Supabase via the JS client.
 *
 * Inserts into TWO tables:
 *  1. dodo_payments       — synthetic "webhook" truth amounts
 *  2. settlement_transactions — CSV rows (what the bank/gateway settled)
 *
 * Run once after applying supabase_schema.sql:
 *   node backend/scripts/seed-sample-data.js
 *
 * Safe to re-run — uses upsert (onConflict) so duplicate rows are ignored.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path = require('path');
const fs   = require('fs');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase client ───────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY ||
    SUPABASE_URL.includes('your-project') || SUPABASE_KEY.includes('your_supabase')) {
  console.error('\n❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing/placeholder in backend/.env');
  console.error('   Fill in real values, then re-run this script.\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── Synthetic dodo_payments rows ──────────────────────────────────────────────
// These represent what the Dodo Payments webhook would have sent.
// Amounts here are the AUTHORITATIVE values; settlement CSV amounts may differ.
// payment_id must match transaction_id in settlement CSVs for the matcher to join them.

const DODO_PAYMENTS = [
  // UPI — exact matches
  { payment_id: 'pay_matched_001',   merchant_order_id: 'ORD-1001', amount: 1500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi'  },
  { payment_id: 'pay_matched_002',   merchant_order_id: 'ORD-1002', amount: 2200.00, currency: 'INR', status: 'succeeded', payment_method: 'upi'  },
  { payment_id: 'pay_matched_003',   merchant_order_id: 'ORD-1003', amount:  850.00, currency: 'INR', status: 'succeeded', payment_method: 'upi'  },
  // UPI — mismatched (webhook 999 vs CSV 1099 → delta −100)
  { payment_id: 'pay_mismatch_001',  merchant_order_id: 'ORD-1004', amount:  999.00, currency: 'INR', status: 'succeeded', payment_method: 'upi'  },
  // UPI — mismatched (webhook 3500 vs CSV 3450 → delta +50)
  { payment_id: 'pay_mismatch_002',  merchant_order_id: 'ORD-1005', amount: 3500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi'  },
  // UPI — duplicate
  { payment_id: 'pay_duplicate_001', merchant_order_id: 'ORD-1007', amount:  500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi'  },
  // Card — missing from settlement
  { payment_id: 'pay_missing_001',   merchant_order_id: 'ORD-1006', amount:  750.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  // Card — exact matches
  { payment_id: 'pay_card_001',      merchant_order_id: 'ORD-2001', amount:  5000.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_002',      merchant_order_id: 'ORD-2002', amount: 12500.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_003',      merchant_order_id: 'ORD-2003', amount:  3750.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_005',      merchant_order_id: 'ORD-2005', amount:  8200.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  // Card — mismatched (webhook 4999 vs CSV 4890 → delta +109)
  { payment_id: 'pay_card_mismatch', merchant_order_id: 'ORD-2004', amount:  4999.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  // Card — missing from settlement
  { payment_id: 'pay_card_004',      merchant_order_id: 'ORD-2006', amount:  6000.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  // Cash — exact matches
  { payment_id: 'pay_cash_001',      merchant_order_id: 'ORD-3001', amount:  300.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_cash_002',      merchant_order_id: 'ORD-3002', amount:  450.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_cash_003',      merchant_order_id: 'ORD-3003', amount: 1200.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  // Cash — missing from settlement
  { payment_id: 'pay_cash_004',      merchant_order_id: 'ORD-3004', amount:  600.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  // Bank — exact matches
  { payment_id: 'pay_bank_001',      merchant_order_id: 'ORD-4001', amount: 25000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_002',      merchant_order_id: 'ORD-4002', amount: 18750.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_004',      merchant_order_id: 'ORD-4004', amount: 32000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  // Bank — mismatched (webhook 10000 vs CSV 9800 → delta +200)
  { payment_id: 'pay_bank_mismatch', merchant_order_id: 'ORD-4003', amount: 10000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  // Bank — missing from settlement
  { payment_id: 'pay_bank_005',      merchant_order_id: 'ORD-4005', amount:  5500.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
];

// ── Load and parse CSV files ──────────────────────────────────────────────────

function loadCsv(filename) {
  const filePath = path.resolve(__dirname, '../../data/samples', filename);
  const content  = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function buildSettlementRows(csvRows, source) {
  return csvRows.map((r) => ({
    transaction_id:    r.transaction_id || r.txn_id || r.id,
    merchant_order_id: r.merchant_order_id || r.order_id || null,
    amount:            parseFloat(r.amount),
    currency:          (r.currency || 'INR').toUpperCase(),
    payment_method:    (r.payment_method || source).toLowerCase(),
    settlement_date:   r.settlement_date || r.date || null,
    source,
    // status / raw_row / row_index not in live table
  }));
}

// ── Insert helpers ────────────────────────────────────────────────────────────

async function upsertDodoPayments(rows) {
  console.log(`\n📥 Upserting ${rows.length} rows → dodo_payments…`);
  const { error, data } = await supabase
    .from('dodo_payments')
    .upsert(rows, { onConflict: 'payment_id', returning: 'representation' });

  if (error) {
    console.error('   ❌ dodo_payments upsert error:', error.message);
    console.error('      code:', error.code, '| details:', error.details);
    throw error;
  }
  console.log(`   ✅ dodo_payments: ${rows.length} rows upserted OK`);
}

async function upsertSettlements(rows, source) {
  console.log(`\n📄 Upserting ${rows.length} rows → settlement_transactions (source: ${source})…`);

  // Filter out rows with no transaction_id
  const valid = rows.filter((r) => r.transaction_id);
  if (valid.length < rows.length) {
    console.warn(`   ⚠️  ${rows.length - valid.length} rows skipped (missing transaction_id)`);
  }

  // Deduplicate by (transaction_id, source) — Postgres can't update the same row twice
  // in one batch. Keep last occurrence (simulates a re-sent/duplicate settlement entry).
  const seen = new Map();
  for (const r of valid) {
    seen.set(`${r.transaction_id}::${r.source}`, r);
  }
  const deduped = [...seen.values()];
  if (deduped.length < valid.length) {
    console.warn(`   ℹ️  ${valid.length - deduped.length} duplicate (transaction_id,source) rows collapsed for upsert`);
  }

  const { error } = await supabase
    .from('settlement_transactions')
    .upsert(deduped, { onConflict: 'transaction_id,source' });

  if (error) {
    console.error(`   ❌ settlement_transactions (${source}) upsert error:`, error.message);
    console.error('      code:', error.code, '| details:', error.details);
    throw error;
  }
  console.log(`   ✅ settlement_transactions (${source}): ${deduped.length} rows upserted OK`);
}

// ── Verify inserted counts ────────────────────────────────────────────────────

async function verifyCounts() {
  console.log('\n🔍 Verifying row counts…');

  const [dodoRes, settlRes] = await Promise.all([
    supabase.from('dodo_payments').select('*', { count: 'exact', head: true }),
    supabase.from('settlement_transactions').select('*', { count: 'exact', head: true }),
  ]);

  if (dodoRes.error)  console.error('   dodo_payments count error:', dodoRes.error.message);
  if (settlRes.error) console.error('   settlement_transactions count error:', settlRes.error.message);

  console.log(`   dodo_payments:          ${dodoRes.count ?? '?'} rows`);
  console.log(`   settlement_transactions: ${settlRes.count ?? '?'} rows`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 Unified Stream — Sample Data Seed');
  console.log('   Supabase URL:', SUPABASE_URL);
  console.log('═'.repeat(56));

  // 1. Seed dodo_payments (synthetic webhook truth)
  await upsertDodoPayments(DODO_PAYMENTS);

  // 2. Seed settlement_transactions from each CSV
  const csvSources = [
    { file: 'upi_settlement.csv',  source: 'upi'  },
    { file: 'card_settlement.csv', source: 'card' },
    { file: 'cash_settlement.csv', source: 'cash' },
    { file: 'bank_settlement.csv', source: 'bank' },
  ];

  for (const { file, source } of csvSources) {
    const csvRows       = loadCsv(file);
    const settlementRows = buildSettlementRows(csvRows, source);
    await upsertSettlements(settlementRows, source);
  }

  // 3. Verify final counts
  await verifyCounts();

  console.log('\n✅ Seed complete! You can now trigger a reconciliation run:');
  console.log('   curl -X POST http://localhost:4000/reconcile/run\n');
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
