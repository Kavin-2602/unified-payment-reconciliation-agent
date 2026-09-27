/**
 * backend/src/reconcile/runner.js
 *
 * Orchestrates a full reconciliation run:
 *  1. Fetch dodo_payments + settlement_transactions from Supabase
 *  2. Call the pure matcher (matcher.js) — no LLM, no side effects
 *  3. Persist results → reconciliation_results table
 *  4. Persist aggregate → reconciliation_runs table
 *
 * Returns the run summary so the route can return it as JSON.
 */

'use strict';

const { supabase } = require('../db/supabaseClient');
const { runMatcher, printSummaryTable } = require('./matcher');

/**
 * Execute a reconciliation run and persist all results.
 *
 * @param {{ triggeredBy?: string }} [opts]
 * @returns {Promise<{
 *   run_id: string,
 *   status: 'completed' | 'failed',
 *   summary: object,
 *   results: object[],
 *   error?: string
 * }>}
 */
async function executeRun({ triggeredBy = 'manual' } = {}) {
  const runId = `run_${Date.now()}`;
  const startedAt = new Date().toISOString();

  // ── 1. Create the run record as 'running' ───────────────────────────────
  const { error: createErr } = await supabase
    .from('reconciliation_runs')
    .insert({
      run_id: runId,
      status: 'running',
      triggered_by: triggeredBy,
      started_at: startedAt,
    });

  if (createErr) {
    console.error('Failed to create run record:', createErr.message);
    throw new Error(`Failed to create reconciliation run: ${createErr.message}`);
  }

  try {
    // ── 2. Fetch source data ──────────────────────────────────────────────
    const [dodoResult, settlementResult] = await Promise.all([
      supabase
        .from('dodo_payments')
        .select('payment_id, amount, currency, status, payment_method, merchant_order_id')
        .in('status', ['succeeded', 'refunded']), // Only process completed payments

      supabase
        .from('settlement_transactions')
        .select('transaction_id, amount, currency, source, payment_method, settlement_date, merchant_order_id'),
    ]);

    if (dodoResult.error) throw new Error(`dodo_payments fetch failed: ${dodoResult.error.message}`);
    if (settlementResult.error) throw new Error(`settlement_transactions fetch failed: ${settlementResult.error.message}`);

    const dodoPayments   = dodoResult.data    || [];
    const settlementRows = settlementResult.data || [];

    console.log(`⚙️  [${runId}] Fetched ${dodoPayments.length} webhook payments, ${settlementRows.length} settlement rows`);

    // ── 3. Run the pure deterministic matcher ─────────────────────────────
    const { results, summary } = runMatcher(dodoPayments, settlementRows);

    // Print the summary table for manual verification
    printSummaryTable(results, summary);

    // ── 4. Persist reconciliation_results (batch insert) ──────────────────
    if (results.length > 0) {
      const resultRows = results.map((r) => ({
        run_id:              runId,
        transaction_id:      r.transaction_id,
        status:              r.status,
        webhook_amount:      r.webhook_amount,
        settlement_amount:   r.settlement_amount,
        amount_delta:        r.amount_delta,
        payment_method:      r.payment_method,
        settlement_source:   r.settlement_source,
        discrepancy_details: r.discrepancy_details,
        // ai_explanation is null here — populated later by /agent/explain (Phase 4)
      }));

      // Insert in chunks of 100 to stay within Supabase payload limits
      const CHUNK_SIZE = 100;
      for (let i = 0; i < resultRows.length; i += CHUNK_SIZE) {
        const chunk = resultRows.slice(i, i + CHUNK_SIZE);
        const { error: insertErr } = await supabase
          .from('reconciliation_results')
          .insert(chunk);

        if (insertErr) {
          throw new Error(`Failed to insert results (chunk ${i / CHUNK_SIZE + 1}): ${insertErr.message}`);
        }
      }
    }

    // ── 5. Mark run as completed with aggregate summary ───────────────────
    const completedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('reconciliation_runs')
      .update({
        status:                   'completed',
        total:                    summary.total,
        matched:                  summary.matched,
        mismatched:               summary.mismatched,
        missing:                  summary.missing,
        duplicate:                summary.duplicate,
        total_amount_discrepancy: summary.total_amount_discrepancy,
        currency:                 'INR',
        completed_at:             completedAt,
      })
      .eq('run_id', runId);

    if (updateErr) {
      throw new Error(`Failed to update run status: ${updateErr.message}`);
    }

    console.log(`✅ [${runId}] Reconciliation complete — ${summary.total} transactions processed`);

    return {
      run_id: runId,
      status: 'completed',
      summary,
      results,
    };

  } catch (err) {
    // Mark run as failed
    await supabase
      .from('reconciliation_runs')
      .update({
        status:        'failed',
        error_message: err.message,
        completed_at:  new Date().toISOString(),
      })
      .eq('run_id', runId);

    console.error(`❌ [${runId}] Reconciliation failed:`, err.message);
    throw err;
  }
}

module.exports = { executeRun };
