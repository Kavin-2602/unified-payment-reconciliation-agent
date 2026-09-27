/**
 * backend/scripts/test-matcher.js
 *
 * Standalone test for the deterministic matcher.
 * Runs WITHOUT a server — loads sample CSV files directly,
 * constructs synthetic dodo_payments rows from them, and
 * verifies all 4 classification cases are correct.
 *
 * Usage:
 *   node backend/scripts/test-matcher.js
 *
 * Expected output: a summary table showing every transaction
 * and its classified status, plus a PASS/FAIL assertion report.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { parse } = require('csv-parse/sync');
const { runMatcher, printSummaryTable } = require('../src/reconcile/matcher');

// ── Load and parse a CSV file into objects ─────────────────────────────────

function loadCsv(filename) {
  const filePath = path.resolve(__dirname, '../../data/samples', filename);
  const content  = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: (value, context) => {
      if (context.column === 'amount') return parseFloat(value);
      return value;
    },
  });
}

// ── Build synthetic dodo_payments from the "truth" amounts ────────────────
// These simulate what would have been stored via the Dodo webhook.
// Amounts here are the AUTHORITATIVE (webhook) values.
// Settlement CSV amounts are what the bank/gateway actually settled.

const DODO_PAYMENTS = [
  // UPI — Matched transactions (webhook amount = settlement amount)
  { payment_id: 'pay_matched_001', amount: 1500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_matched_002', amount: 2200.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_matched_003', amount:  850.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },

  // UPI — Mismatched (webhook says 999, CSV says 1099 → delta = -100)
  { payment_id: 'pay_mismatch_001', amount:  999.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },

  // UPI — Mismatched (webhook says 3500, CSV says 3450 → delta = +50)
  { payment_id: 'pay_mismatch_002', amount: 3500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },

  // UPI — Duplicate (same payment_id in two settlement sources → handled on settlement side)
  { payment_id: 'pay_duplicate_001', amount: 500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },

  // UPI — Missing (in webhook, NOT in any settlement CSV)
  { payment_id: 'pay_missing_001', amount: 750.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },

  // Card — Matched
  { payment_id: 'pay_card_001', amount:  5000.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_002', amount: 12500.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_003', amount:  3750.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_005', amount:  8200.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },

  // Card — Mismatched (webhook 4999, CSV 4890 → delta = +109)
  { payment_id: 'pay_card_mismatch', amount: 4999.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },

  // Card — Missing (pay_card_004 in webhook but NOT in any settlement CSV)
  { payment_id: 'pay_card_004', amount: 6000.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },

  // Cash — Matched
  { payment_id: 'pay_cash_001', amount:  300.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_cash_002', amount:  450.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_cash_003', amount: 1200.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },

  // Cash — Missing (pay_cash_004 in webhook but NOT in any settlement CSV)
  { payment_id: 'pay_cash_004', amount: 600.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },

  // Bank — Matched
  { payment_id: 'pay_bank_001', amount: 25000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_002', amount: 18750.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_004', amount: 32000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },

  // Bank — Mismatched (webhook 10000, CSV 9800 → delta = +200)
  { payment_id: 'pay_bank_mismatch', amount: 10000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },

  // Bank — Missing (pay_bank_005 in webhook but NOT in any settlement CSV)
  { payment_id: 'pay_bank_005', amount: 5500.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
];

// ── Load all settlement CSVs and combine ──────────────────────────────────

function loadAllSettlements() {
  const sources = [
    { file: 'upi_settlement.csv',  source: 'upi' },
    { file: 'card_settlement.csv', source: 'card' },
    { file: 'cash_settlement.csv', source: 'cash' },
    { file: 'bank_settlement.csv', source: 'bank' },
  ];

  const allRows = [];
  for (const { file, source } of sources) {
    const rows = loadCsv(file).map((r) => ({
      transaction_id: r.transaction_id || r.txn_id || r.id,
      amount:         parseFloat(r.amount),
      currency:       r.currency || 'INR',
      payment_method: r.payment_method || source,
      source,
    }));
    console.log(`  Loaded ${rows.length} rows from ${file}`);
    allRows.push(...rows);
  }
  return allRows;
}

// ── Assertion helpers ─────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function assert(condition, label, expected, actual) {
  if (condition) {
    passCount++;
    console.log(`  ✅ PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  ❌ FAIL  ${label}`);
    console.log(`         Expected: ${expected}`);
    console.log(`         Actual:   ${actual}`);
  }
}

function getStatus(results, transactionId) {
  const r = results.find((x) => x.transaction_id === transactionId);
  return r ? r.status : 'NOT_FOUND';
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('\n🔍 Loading settlement CSV files...');
  const settlementRows = loadAllSettlements();

  console.log(`\n⚙️  Running matcher: ${DODO_PAYMENTS.length} webhook payments × ${settlementRows.length} settlement rows`);
  const { results, summary } = runMatcher(DODO_PAYMENTS, settlementRows);

  // Print full summary table
  printSummaryTable(results, summary);

  // ── Assertions ─────────────────────────────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('  ASSERTIONS');
  console.log('─'.repeat(70));

  // ── MATCHED cases ───────────────────────────────────────────────────────────
  console.log('\n  [MATCHED — UPI]');
  assert(getStatus(results, 'pay_matched_001') === 'MATCHED', 'pay_matched_001 → MATCHED', 'MATCHED', getStatus(results, 'pay_matched_001'));
  assert(getStatus(results, 'pay_matched_002') === 'MATCHED', 'pay_matched_002 → MATCHED', 'MATCHED', getStatus(results, 'pay_matched_002'));
  assert(getStatus(results, 'pay_matched_003') === 'MATCHED', 'pay_matched_003 → MATCHED', 'MATCHED', getStatus(results, 'pay_matched_003'));

  console.log('\n  [MATCHED — Card]');
  assert(getStatus(results, 'pay_card_001') === 'MATCHED', 'pay_card_001 → MATCHED', 'MATCHED', getStatus(results, 'pay_card_001'));
  assert(getStatus(results, 'pay_card_002') === 'MATCHED', 'pay_card_002 → MATCHED', 'MATCHED', getStatus(results, 'pay_card_002'));
  assert(getStatus(results, 'pay_card_003') === 'MATCHED', 'pay_card_003 → MATCHED', 'MATCHED', getStatus(results, 'pay_card_003'));
  assert(getStatus(results, 'pay_card_005') === 'MATCHED', 'pay_card_005 → MATCHED', 'MATCHED', getStatus(results, 'pay_card_005'));

  console.log('\n  [MATCHED — Cash]');
  assert(getStatus(results, 'pay_cash_001') === 'MATCHED', 'pay_cash_001 → MATCHED', 'MATCHED', getStatus(results, 'pay_cash_001'));
  assert(getStatus(results, 'pay_cash_002') === 'MATCHED', 'pay_cash_002 → MATCHED', 'MATCHED', getStatus(results, 'pay_cash_002'));
  assert(getStatus(results, 'pay_cash_003') === 'MATCHED', 'pay_cash_003 → MATCHED', 'MATCHED', getStatus(results, 'pay_cash_003'));

  console.log('\n  [MATCHED — Bank]');
  assert(getStatus(results, 'pay_bank_001') === 'MATCHED', 'pay_bank_001 → MATCHED', 'MATCHED', getStatus(results, 'pay_bank_001'));
  assert(getStatus(results, 'pay_bank_002') === 'MATCHED', 'pay_bank_002 → MATCHED', 'MATCHED', getStatus(results, 'pay_bank_002'));
  assert(getStatus(results, 'pay_bank_004') === 'MATCHED', 'pay_bank_004 → MATCHED', 'MATCHED', getStatus(results, 'pay_bank_004'));

  // ── MISMATCHED cases ────────────────────────────────────────────────────────
  console.log('\n  [MISMATCHED]');
  assert(getStatus(results, 'pay_mismatch_001') === 'MISMATCHED',   'pay_mismatch_001 → MISMATCHED',   'MISMATCHED', getStatus(results, 'pay_mismatch_001'));
  assert(getStatus(results, 'pay_mismatch_002') === 'MISMATCHED',   'pay_mismatch_002 → MISMATCHED',   'MISMATCHED', getStatus(results, 'pay_mismatch_002'));
  assert(getStatus(results, 'pay_card_mismatch') === 'MISMATCHED',  'pay_card_mismatch → MISMATCHED',  'MISMATCHED', getStatus(results, 'pay_card_mismatch'));
  assert(getStatus(results, 'pay_bank_mismatch') === 'MISMATCHED',  'pay_bank_mismatch → MISMATCHED',  'MISMATCHED', getStatus(results, 'pay_bank_mismatch'));

  // Verify delta values on mismatches
  const mm1 = results.find((r) => r.transaction_id === 'pay_mismatch_001');
  assert(mm1?.amount_delta === -100, 'pay_mismatch_001 delta = -100 (999 - 1099)', -100, mm1?.amount_delta);

  const mm2 = results.find((r) => r.transaction_id === 'pay_mismatch_002');
  assert(mm2?.amount_delta === 50, 'pay_mismatch_002 delta = +50 (3500 - 3450)', 50, mm2?.amount_delta);

  const cm = results.find((r) => r.transaction_id === 'pay_card_mismatch');
  assert(cm?.amount_delta === 109, 'pay_card_mismatch delta = +109 (4999 - 4890)', 109, cm?.amount_delta);

  const bm = results.find((r) => r.transaction_id === 'pay_bank_mismatch');
  assert(bm?.amount_delta === 200, 'pay_bank_mismatch delta = +200 (10000 - 9800)', 200, bm?.amount_delta);

  // ── MISSING cases ───────────────────────────────────────────────────────────
  console.log('\n  [MISSING — webhook only, no settlement]');
  assert(getStatus(results, 'pay_missing_001') === 'MISSING', 'pay_missing_001 → MISSING', 'MISSING', getStatus(results, 'pay_missing_001'));
  assert(getStatus(results, 'pay_card_004')    === 'MISSING', 'pay_card_004 → MISSING',    'MISSING', getStatus(results, 'pay_card_004'));
  assert(getStatus(results, 'pay_cash_004')    === 'MISSING', 'pay_cash_004 → MISSING',    'MISSING', getStatus(results, 'pay_cash_004'));
  assert(getStatus(results, 'pay_bank_005')    === 'MISSING', 'pay_bank_005 → MISSING',    'MISSING', getStatus(results, 'pay_bank_005'));

  console.log('\n  [MISSING — settlement only, no webhook]');
  assert(getStatus(results, 'pay_extra_settlement') === 'MISSING', 'pay_extra_settlement → MISSING (orphan)', 'MISSING', getStatus(results, 'pay_extra_settlement'));

  // ── DUPLICATE cases ─────────────────────────────────────────────────────────
  console.log('\n  [DUPLICATE]');
  // pay_duplicate_001 appears twice in upi_settlement.csv
  // BUT: settlement_transactions table has UNIQUE(transaction_id, source)
  // So if both rows have source='upi', only 1 row exists in DB.
  // The matcher sees 1 settlement row → MATCHED (not DUPLICATE).
  // DUPLICATE would occur if it appeared in MULTIPLE sources (e.g., upi AND card).
  // Since our sample data has both with source='upi', the DB deduplicates them.
  // We test with a synthetic scenario instead:
  const dupSettlements = [
    { transaction_id: 'pay_duplicate_001', amount: 500, currency: 'INR', source: 'upi',  payment_method: 'upi' },
    { transaction_id: 'pay_duplicate_001', amount: 500, currency: 'INR', source: 'card', payment_method: 'card' },
  ];
  const dupDodo = [
    { payment_id: 'pay_duplicate_001', amount: 500, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  ];
  const { results: dupResults } = runMatcher(dupDodo, dupSettlements);
  const dupStatus = dupResults.find((r) => r.transaction_id === 'pay_duplicate_001')?.status;
  assert(dupStatus === 'DUPLICATE', 'pay_duplicate_001 → DUPLICATE (2 settlement sources)', 'DUPLICATE', dupStatus);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
  console.log('─'.repeat(70) + '\n');

  // Summary counts check
  console.log('  Run summary:');
  console.log(`    Total processed : ${summary.total}`);
  console.log(`    MATCHED         : ${summary.matched}`);
  console.log(`    MISMATCHED      : ${summary.mismatched}`);
  console.log(`    MISSING         : ${summary.missing}`);
  console.log(`    DUPLICATE       : ${summary.duplicate}`);
  console.log(`    Total discrepancy: ₹${summary.total_amount_discrepancy}`);
  console.log('');

  if (failCount > 0) {
    process.exit(1); // Non-zero exit so CI can catch failures
  }
}

main();
