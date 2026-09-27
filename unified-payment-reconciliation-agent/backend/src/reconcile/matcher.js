/**
 * backend/src/reconcile/matcher.js
 *
 * Pure deterministic reconciliation engine.
 * ─────────────────────────────────────────
 * NO LLM calls. NO async I/O. Takes plain JS objects in, returns results out.
 * All classification decisions are made here by code, never by the LLM.
 *
 * Classification rules (in priority order):
 *  1. DUPLICATE  — same transaction_id appears more than once across settlement rows
 *  2. MISSING    — dodo payment has no settlement row (or settlement has no dodo payment)
 *  3. MISMATCHED — matched by transaction_id but amounts differ by more than AMOUNT_TOLERANCE
 *  4. MATCHED    — matched by transaction_id and amounts are equal within tolerance
 *
 * Amount tolerance: ₹0.50 — accounts for gateway rounding differences.
 */

'use strict';

const AMOUNT_TOLERANCE = 0.50; // INR

/**
 * Run the reconciliation engine over pre-fetched data.
 *
 * @param {object[]} dodoPayments        Rows from dodo_payments table
 *   Each row must have: { payment_id, amount, currency, payment_method, status, ... }
 *
 * @param {object[]} settlementRows      Rows from settlement_transactions table
 *   Each row must have: { transaction_id, amount, currency, source, payment_method, ... }
 *
 * @returns {{ results: MatchResult[], summary: RunSummary }}
 */
function runMatcher(dodoPayments, settlementRows) {
  const results = [];

  // ── Step 1: Index settlements by transaction_id ────────────────────────────
  // Map: transaction_id → [settlement rows]
  // A given transaction_id can appear in multiple sources (upi, card, etc.)
  // because settlement_transactions has UNIQUE(transaction_id, source).
  /** @type {Map<string, object[]>} */
  const settlementIndex = new Map();
  for (const row of settlementRows) {
    const key = row.transaction_id;
    if (!settlementIndex.has(key)) {
      settlementIndex.set(key, []);
    }
    settlementIndex.get(key).push(row);
  }

  // Track which settlement transaction_ids are consumed (to find orphan settlements)
  const consumedSettlementIds = new Set();

  // ── Step 2: Index dodo payments by payment_id (detect webhook-side duplicates) ─
  // dodo_payments has UNIQUE payment_id, so true duplicates cannot exist there.
  // We still check for safety.
  /** @type {Map<string, object[]>} */
  const dodoIndex = new Map();
  for (const pmt of dodoPayments) {
    const key = pmt.payment_id;
    if (!dodoIndex.has(key)) {
      dodoIndex.set(key, []);
    }
    dodoIndex.get(key).push(pmt);
  }

  // ── Step 3: Classify each dodo payment ────────────────────────────────────
  for (const [paymentId, dodoRows] of dodoIndex.entries()) {
    const dodo = dodoRows[0]; // Always 1 due to UNIQUE constraint
    const settlements = settlementIndex.get(paymentId) || [];

    consumedSettlementIds.add(paymentId);

    if (settlements.length === 0) {
      // ── MISSING: dodo payment has no settlement counterpart ─────────────
      results.push(
        buildResult(paymentId, 'MISSING', dodo, null, {
          reason: 'No settlement row found for this payment ID across any source',
          missing_side: 'settlement',
        })
      );
      continue;
    }

    if (settlements.length > 1) {
      // ── DUPLICATE: same transaction_id found in multiple settlement sources ─
      // e.g., appears in both upi and card settlement files, or raw CSV had
      // duplicate rows that bypassed the UNIQUE(transaction_id, source) constraint
      // by differing in source.
      results.push(
        buildResult(paymentId, 'DUPLICATE', dodo, settlements[0], {
          reason: `transaction_id '${paymentId}' found in ${settlements.length} settlement rows (sources: ${settlements.map((s) => s.source).join(', ')})`,
          settlement_count: settlements.length,
          sources: settlements.map((s) => ({ source: s.source, amount: Number(s.amount) })),
        })
      );
      continue;
    }

    // Exactly 1 settlement row — compare amounts
    const settlement = settlements[0];
    const dodoAmt = Number(dodo.amount);
    const settlAmt = Number(settlement.amount);
    const delta = parseFloat((dodoAmt - settlAmt).toFixed(2));

    if (Math.abs(delta) <= AMOUNT_TOLERANCE) {
      // ── MATCHED ─────────────────────────────────────────────────────────
      results.push(
        buildResult(paymentId, 'MATCHED', dodo, settlement, null, delta)
      );
    } else {
      // ── MISMATCHED ───────────────────────────────────────────────────────
      results.push(
        buildResult(paymentId, 'MISMATCHED', dodo, settlement, {
          reason: 'Amount in webhook differs from settlement CSV amount',
          field: 'amount',
          expected: dodoAmt,
          actual: settlAmt,
          delta,
        }, delta)
      );
    }
  }

  // ── Step 4: Orphan settlements (in CSV but no dodo payment) ───────────────
  for (const [txnId, settlements] of settlementIndex.entries()) {
    if (consumedSettlementIds.has(txnId)) continue;

    // One or more settlement rows with no corresponding webhook payment
    for (const settlement of settlements) {
      results.push(
        buildResult(txnId, 'MISSING', null, settlement, {
          reason: 'Settlement row exists in CSV but no matching Dodo webhook payment found',
          missing_side: 'webhook',
        })
      );
    }
  }

  // ── Step 5: Compute summary ────────────────────────────────────────────────
  const summary = computeSummary(results);

  return { results, summary };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a single MatchResult object.
 * @param {string}      transactionId
 * @param {string}      status         MATCHED | MISMATCHED | MISSING | DUPLICATE
 * @param {object|null} dodo           Row from dodo_payments
 * @param {object|null} settlement     Row from settlement_transactions
 * @param {object|null} discrepancyDetails
 * @param {number}      [delta=0]      webhook_amount - settlement_amount
 * @returns {MatchResult}
 */
function buildResult(transactionId, status, dodo, settlement, discrepancyDetails, delta = 0) {
  const webhookAmount  = dodo       ? Number(dodo.amount)       : null;
  const settlementAmount = settlement ? Number(settlement.amount) : null;

  return {
    transaction_id:      transactionId,
    status,
    webhook_amount:      webhookAmount,
    settlement_amount:   settlementAmount,
    amount_delta:        delta,
    payment_method:      dodo?.payment_method || settlement?.payment_method || null,
    settlement_source:   settlement?.source || null,
    discrepancy_details: discrepancyDetails || null,
  };
}

/**
 * Aggregate counts and total discrepancy from a results array.
 * @param {MatchResult[]} results
 * @returns {RunSummary}
 */
function computeSummary(results) {
  let matched = 0, mismatched = 0, missing = 0, duplicate = 0;
  let totalAmountDiscrepancy = 0;

  for (const r of results) {
    switch (r.status) {
      case 'MATCHED':    matched++;    break;
      case 'MISMATCHED': mismatched++; totalAmountDiscrepancy += Math.abs(r.amount_delta); break;
      case 'MISSING':    missing++;    break;
      case 'DUPLICATE':  duplicate++;  break;
    }
  }

  return {
    total:                    results.length,
    matched,
    mismatched,
    missing,
    duplicate,
    total_amount_discrepancy: parseFloat(totalAmountDiscrepancy.toFixed(2)),
  };
}

// ── Printed summary table (for manual verification / test script) ────────────

/**
 * Print a summary table of results to stdout.
 * Used by the test script. Not called in production request handling.
 * @param {MatchResult[]} results
 * @param {RunSummary}    summary
 */
function printSummaryTable(results, summary) {
  const STATUS_ICONS = {
    MATCHED:    '✅',
    MISMATCHED: '⚠️ ',
    MISSING:    '❌',
    DUPLICATE:  '♻️ ',
  };

  const COL_WIDTHS = { id: 26, status: 12, webhook: 12, settlement: 14, delta: 10, source: 8 };

  const pad = (str, n) => String(str ?? '—').padEnd(n);
  const padL = (str, n) => String(str ?? '—').padStart(n);

  const header =
    pad('Transaction ID', COL_WIDTHS.id) +
    pad('Status', COL_WIDTHS.status) +
    padL('Webhook ₹', COL_WIDTHS.webhook) +
    padL('Settlement ₹', COL_WIDTHS.settlement) +
    padL('Delta', COL_WIDTHS.delta) +
    pad('  Source', COL_WIDTHS.source);

  const divider = '─'.repeat(header.length);

  console.log('\n' + divider);
  console.log('  UNIFIED STREAM · RECONCILIATION RESULTS');
  console.log(divider);
  console.log(header);
  console.log(divider);

  for (const r of results) {
    const icon = STATUS_ICONS[r.status] || '?';
    const line =
      pad(r.transaction_id, COL_WIDTHS.id) +
      pad(`${icon} ${r.status}`, COL_WIDTHS.status + 2) +
      padL(r.webhook_amount ?? '—', COL_WIDTHS.webhook) +
      padL(r.settlement_amount ?? '—', COL_WIDTHS.settlement) +
      padL(r.amount_delta !== 0 ? r.amount_delta : '0', COL_WIDTHS.delta) +
      '  ' + (r.settlement_source || '—');
    console.log(line);
  }

  console.log(divider);
  console.log(`  Total: ${summary.total}  |  ` +
    `✅ ${summary.matched}  ` +
    `⚠️  ${summary.mismatched}  ` +
    `❌ ${summary.missing}  ` +
    `♻️  ${summary.duplicate}  |  ` +
    `Discrepancy: ₹${summary.total_amount_discrepancy}`);
  console.log(divider + '\n');
}

module.exports = { runMatcher, printSummaryTable, AMOUNT_TOLERANCE };
