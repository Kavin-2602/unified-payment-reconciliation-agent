/**
 * backend/src/agent/prompts.js
 * Prompt builder functions for Gemini.
 *
 * RULE: These prompts receive PRE-COMPUTED results from the reconciliation
 * engine. They instruct Gemini to explain or summarise — never to classify.
 */

/**
 * Build the prompt for explaining a single transaction discrepancy.
 * @param {object} data
 * @param {string} data.transaction_id
 * @param {string} data.status  — already determined by deterministic code
 * @param {number|null} data.webhook_amount
 * @param {number|null} data.settlement_amount
 * @param {string} data.payment_method
 * @param {object} data.discrepancy_details
 */
function buildExplainPrompt(data) {
  return `You are a financial reconciliation assistant for an Indian MSME.

A payment reconciliation system has already determined (using deterministic code, not you) that transaction ${data.transaction_id} has status: ${data.status}.

Your ONLY job is to explain WHY this discrepancy may have occurred in 2-3 concise sentences, in plain business English.

Transaction details:
- Transaction ID: ${data.transaction_id}
- Status: ${data.status}
- Payment method: ${data.payment_method || 'unknown'}
- Amount in Dodo Payments webhook: ${data.webhook_amount != null ? `₹${data.webhook_amount}` : 'Not found'}
- Amount in settlement CSV: ${data.settlement_amount != null ? `₹${data.settlement_amount}` : 'Not found'}
- Discrepancy details: ${JSON.stringify(data.discrepancy_details || {})}

Rules:
- Do NOT re-classify the transaction. Its status is final.
- Do NOT say what the correct amount should be.
- Keep your explanation under 60 words.
- Be factual and concise.

Explanation:`;
}

/**
 * Build the prompt for summarising a full reconciliation run.
 * @param {object} data
 * @param {string} data.run_id
 * @param {number} data.total
 * @param {number} data.matched
 * @param {number} data.mismatched
 * @param {number} data.missing
 * @param {number} data.duplicate
 * @param {number} data.total_amount_discrepancy
 * @param {string} data.currency
 * @param {Array}  data.mismatched_transactions
 */
function buildSummarizePrompt(data) {
  const mismatchList = (data.mismatched_transactions || [])
    .slice(0, 5)
    .map(
      (t) =>
        `  - ${t.transaction_id}: webhook ₹${t.webhook_amount} vs settlement ₹${t.settlement_amount}`
    )
    .join('\n');

  return `You are a financial reconciliation assistant for an Indian MSME.

A payment reconciliation system has finished a run and produced these results (computed by deterministic code, not you):

Run ID: ${data.run_id}
Total transactions checked: ${data.total}
- MATCHED: ${data.matched}
- MISMATCHED: ${data.mismatched}
- MISSING: ${data.missing}
- DUPLICATE: ${data.duplicate}
Total amount discrepancy: ₹${data.total_amount_discrepancy || 0} ${data.currency || 'INR'}
${mismatchList ? `\nTop mismatched transactions:\n${mismatchList}` : ''}

Write a concise 3-4 sentence business summary of this reconciliation run.
- Start with what was reconciled overall.
- Highlight key issues if any.
- Suggest one next action if there are discrepancies.
- Keep it under 100 words. No bullet points.

Summary:`;
}

module.exports = { buildExplainPrompt, buildSummarizePrompt };
