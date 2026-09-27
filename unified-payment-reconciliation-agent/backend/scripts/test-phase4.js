/**
 * backend/scripts/test-phase4.js
 *
 * Tests Phase 4: AI explanations wired into reconciliation results.
 *
 * Runs WITHOUT a live server or Supabase. Uses the same sample data
 * as Phase 3 test, runs the matcher in-process, then calls Gemini
 * directly via the explainer + summarizer modules.
 *
 * Requirements:
 *   - GEMINI_API_KEY set in backend/.env (loaded via dotenv)
 *
 * Usage:
 *   node backend/scripts/test-phase4.js
 *
 * Output:
 *   - Matcher summary table (same as Phase 3)
 *   - Actual Gemini explanation for pay_mismatch_001
 *   - Actual Gemini explanation for pay_bank_mismatch
 *   - Full Gemini-generated run report summary
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path = require('path');
const fs   = require('fs');
const { parse } = require('csv-parse/sync');
const { runMatcher, printSummaryTable } = require('../src/reconcile/matcher');
const { model } = require('../src/agent/geminiClient');
const { buildExplainPrompt, buildSummarizePrompt } = require('../src/agent/prompts');

// ── Load CSVs (same as Phase 3 test) ─────────────────────────────────────────

function loadCsv(filename) {
  const filePath = path.resolve(__dirname, '../../data/samples', filename);
  const content  = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true, skip_empty_lines: true, trim: true,
    cast: (value, context) => context.column === 'amount' ? parseFloat(value) : value,
  });
}

function loadAllSettlements() {
  return [
    { file: 'upi_settlement.csv',  source: 'upi' },
    { file: 'card_settlement.csv', source: 'card' },
    { file: 'cash_settlement.csv', source: 'cash' },
    { file: 'bank_settlement.csv', source: 'bank' },
  ].flatMap(({ file, source }) =>
    loadCsv(file).map((r) => ({
      transaction_id: r.transaction_id,
      amount:         parseFloat(r.amount),
      currency:       r.currency || 'INR',
      payment_method: r.payment_method || source,
      source,
    }))
  );
}

const DODO_PAYMENTS = [
  { payment_id: 'pay_matched_001',   amount: 1500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_matched_002',   amount: 2200.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_matched_003',   amount:  850.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_mismatch_001',  amount:  999.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_mismatch_002',  amount: 3500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_duplicate_001', amount:  500.00, currency: 'INR', status: 'succeeded', payment_method: 'upi' },
  { payment_id: 'pay_missing_001',   amount:  750.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_001',      amount: 5000.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_002',      amount:12500.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_003',      amount: 3750.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_005',      amount: 8200.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_mismatch', amount: 4999.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_card_004',      amount: 6000.00, currency: 'INR', status: 'succeeded', payment_method: 'card' },
  { payment_id: 'pay_cash_001',      amount:  300.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_cash_002',      amount:  450.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_cash_003',      amount: 1200.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_cash_004',      amount:  600.00, currency: 'INR', status: 'succeeded', payment_method: 'cash' },
  { payment_id: 'pay_bank_001',      amount:25000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_002',      amount:18750.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_004',      amount:32000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_mismatch', amount:10000.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
  { payment_id: 'pay_bank_005',      amount: 5500.00, currency: 'INR', status: 'succeeded', payment_method: 'bank' },
];

// ── Helper: call Gemini with extended prompt ──────────────────────────────────

async function callExplain(matchResult) {
  const basePrompt = buildExplainPrompt({
    transaction_id:      matchResult.transaction_id,
    status:              matchResult.status,
    webhook_amount:      matchResult.webhook_amount,
    settlement_amount:   matchResult.settlement_amount,
    payment_method:      matchResult.payment_method,
    discrepancy_details: matchResult.discrepancy_details,
  });

  const fullPrompt = basePrompt + `

Additionally, on a new line starting with "Action:", suggest one concrete
recommended_action (max 15 words) that the MSME finance team should take
to resolve this discrepancy.`;

  const response = await model.generateContent(fullPrompt);
  return response.response.text().trim();
}

async function callSummarize(summary, mismatchedResults) {
  const prompt = buildSummarizePrompt({
    run_id:                   'run_phase4_test',
    total:                    summary.total,
    matched:                  summary.matched,
    mismatched:               summary.mismatched,
    missing:                  summary.missing,
    duplicate:                summary.duplicate,
    total_amount_discrepancy: summary.total_amount_discrepancy,
    currency:                 'INR',
    mismatched_transactions:  mismatchedResults
      .filter((r) => r.status === 'MISMATCHED')
      .slice(0, 5)
      .map((r) => ({
        transaction_id:    r.transaction_id,
        webhook_amount:    r.webhook_amount,
        settlement_amount: r.settlement_amount,
      })),
  });

  const response = await model.generateContent(prompt);
  return response.response.text().trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 Loading settlement CSV files...');
  const settlementRows = loadAllSettlements();

  console.log(`⚙️  Running matcher: ${DODO_PAYMENTS.length} webhook payments × ${settlementRows.length} settlement rows`);
  const { results, summary } = runMatcher(DODO_PAYMENTS, settlementRows);

  printSummaryTable(results, summary);

  const divider = '═'.repeat(72);

  // ── Explanation 1: pay_mismatch_001 ──────────────────────────────────────
  const mm1 = results.find((r) => r.transaction_id === 'pay_mismatch_001');
  console.log(divider);
  console.log('  🤖 GEMINI EXPLANATION — pay_mismatch_001 (MISMATCHED)');
  console.log(`     Webhook: ₹${mm1.webhook_amount}  |  Settlement: ₹${mm1.settlement_amount}  |  Delta: ₹${mm1.amount_delta}`);
  console.log(divider);
  const exp1 = await callExplain(mm1);
  console.log('\n' + exp1 + '\n');

  // ── Explanation 2: pay_bank_mismatch ─────────────────────────────────────
  const bm = results.find((r) => r.transaction_id === 'pay_bank_mismatch');
  console.log(divider);
  console.log('  🤖 GEMINI EXPLANATION — pay_bank_mismatch (MISMATCHED)');
  console.log(`     Webhook: ₹${bm.webhook_amount}  |  Settlement: ₹${bm.settlement_amount}  |  Delta: ₹${bm.amount_delta}`);
  console.log(divider);
  const exp2 = await callExplain(bm);
  console.log('\n' + exp2 + '\n');

  // ── Run report summary ────────────────────────────────────────────────────
  console.log(divider);
  console.log('  🤖 GEMINI RUN REPORT SUMMARY');
  console.log(divider);
  const reportSummary = await callSummarize(summary, results);
  console.log('\n' + reportSummary + '\n');
  console.log(divider);
  console.log('  ✅ Phase 4 test complete — Gemini integration verified.');
  console.log(divider + '\n');
}

main().catch((err) => {
  console.error('\n❌ Phase 4 test failed:', err.message);
  process.exit(1);
});
