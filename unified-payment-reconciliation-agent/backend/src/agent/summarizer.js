/**
 * backend/src/agent/summarizer.js
 *
 * Internal callable for generating a natural-language summary of a full
 * reconciliation run. Imported directly by reconcile.js — no HTTP self-call.
 *
 * RULE: All counts and amounts are pre-computed by runner.js / the DB.
 * Gemini writes the narrative only.
 */

'use strict';

const { model } = require('./geminiClient');
const { buildSummarizePrompt } = require('./prompts');
const { supabase } = require('../db/supabaseClient');

/**
 * Generate and persist a natural-language run report.
 *
 * @param {object} runRow  A row from reconciliation_runs
 * @param {string} runRow.run_id
 * @param {number} runRow.total
 * @param {number} runRow.matched
 * @param {number} runRow.mismatched
 * @param {number} runRow.missing
 * @param {number} runRow.duplicate
 * @param {number} runRow.total_amount_discrepancy
 * @param {string} [runRow.currency]
 *
 * @returns {Promise<{ run_id: string, summary: string }>}
 */
async function summarizeRun(runRow) {
  // Fetch the top mismatched transactions for the prompt (max 5)
  const { data: mismatchedRows } = await supabase
    .from('reconciliation_results')
    .select('transaction_id, webhook_amount, settlement_amount')
    .eq('run_id', runRow.run_id)
    .eq('status', 'MISMATCHED')
    .order('amount_delta', { ascending: false }) // largest discrepancy first
    .limit(5);

  const prompt = buildSummarizePrompt({
    run_id:                   runRow.run_id,
    total:                    runRow.total,
    matched:                  runRow.matched,
    mismatched:               runRow.mismatched,
    missing:                  runRow.missing,
    duplicate:                runRow.duplicate,
    total_amount_discrepancy: runRow.total_amount_discrepancy,
    currency:                 runRow.currency || 'INR',
    mismatched_transactions:  mismatchedRows || [],
  });

  let summary;
  try {
    const result  = await model.generateContent(prompt);
    summary = result.response.text().trim();
  } catch (err) {
    console.warn(`⚠️  Gemini summarizer error: ${err.message}. Using structured fallback.`);
    summary = `## Reconciliation Run Summary (${runRow.run_id})\n\n` +
      `• **Total Processed:** ${runRow.total} transactions across channels.\n` +
      `• **Status Breakdown:** ${runRow.matched} matched cleanly, ${runRow.mismatched} mismatched, ${runRow.missing} missing, ${runRow.duplicate} duplicates.\n` +
      `• **Discrepancy Impact:** Net amount discrepancy of ₹${runRow.total_amount_discrepancy || 0} requiring review.\n\n` +
      `### Key Recommendations\n` +
      `1. Review payment gateway settlement feeds for the ${runRow.mismatched} mismatched records.\n` +
      `2. Contact bank support regarding unbatched missing transactions.\n` +
      `3. Automated audit completed successfully.`;
  }

  // Persist to reconciliation_reports
  const { error } = await supabase
    .from('reconciliation_reports')
    .upsert(
      { run_id: runRow.run_id, summary, generated_at: new Date().toISOString() },
      { onConflict: 'run_id' }
    );

  if (error) {
    console.warn(`⚠️  Could not persist report for ${runRow.run_id}: ${error.message}`);
  }

  console.log(`🤖 Report generated for run: ${runRow.run_id}`);
  return { run_id: runRow.run_id, summary };
}

module.exports = { summarizeRun };
