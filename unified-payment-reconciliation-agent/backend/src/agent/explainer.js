/**
 * backend/src/agent/explainer.js
 *
 * Internal callable for generating a natural-language explanation of a
 * single reconciliation result. Imported directly by reconcile.js —
 * no HTTP self-call.
 *
 * RULE: This function receives classification + amounts already computed
 * by matcher.js. Gemini explains the discrepancy; it never re-classifies.
 */

'use strict';

const { model } = require('./geminiClient');
const { buildExplainPrompt } = require('./prompts');

/**
 * Generate a natural-language explanation for a single reconciliation result.
 *
 * @param {object} row  A row from reconciliation_results (or a MatchResult)
 * @param {string} row.transaction_id
 * @param {string} row.status              MISMATCHED | MISSING | DUPLICATE
 * @param {number|null} row.webhook_amount
 * @param {number|null} row.settlement_amount
 * @param {number}      row.amount_delta
 * @param {string|null} row.payment_method
 * @param {object|null} row.discrepancy_details
 *
 * @returns {Promise<{ explanation: string, recommended_action: string }>}
 */
async function explainResult(row) {
  // Build the standard explain prompt from prompts.js (unchanged)
  const basePrompt = buildExplainPrompt({
    transaction_id:      row.transaction_id,
    status:              row.status,
    webhook_amount:      row.webhook_amount,
    settlement_amount:   row.settlement_amount,
    payment_method:      row.payment_method,
    discrepancy_details: row.discrepancy_details,
  });

  // Extend the prompt to also request a recommended_action field,
  // keeping the LLM contract: amounts and status are given, never guessed.
  const fullPrompt = basePrompt + `

Additionally, on a new line starting with "Action:", suggest one concrete
recommended_action (max 15 words) that the MSME finance team should take
to resolve this discrepancy.`;

  const result  = await model.generateContent(fullPrompt);
  const raw     = result.response.text().trim();

  // Split explanation from the "Action:" suffix
  const actionMatch = raw.match(/\n?Action:\s*(.+)/s);
  const explanation = actionMatch
    ? raw.slice(0, raw.indexOf('\n\nAction:')).trim() ||
      raw.slice(0, raw.indexOf('\nAction:')).trim()
    : raw;
  const recommended_action = actionMatch
    ? actionMatch[1].trim()
    : 'Review transaction with payment gateway and settlement team.';

  return { explanation, recommended_action };
}

module.exports = { explainResult };
