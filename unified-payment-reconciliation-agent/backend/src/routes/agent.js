/**
 * backend/src/routes/agent.js
 * AI agent endpoints — mounted at /agent on the main Express app.
 *
 * POST /agent/explain    → NL explanation for a single discrepancy
 * POST /agent/summarize  → NL summary of a full reconciliation run
 *
 * RULE: These routes receive pre-computed results from the reconciliation
 * engine. Gemini only generates text — it never classifies transactions.
 */

const router = require('express').Router();
const { model } = require('../agent/geminiClient');
const { buildExplainPrompt, buildSummarizePrompt } = require('../agent/prompts');

// ── POST /agent/explain ───────────────────────────────────────
/**
 * Explain a single discrepancy in natural language.
 *
 * Request body:
 * {
 *   transaction_id: string,
 *   status: "MISMATCHED" | "MISSING" | "DUPLICATE",   ← set by engine, not LLM
 *   webhook_amount: number | null,
 *   settlement_amount: number | null,
 *   payment_method: string,
 *   discrepancy_details: object
 * }
 *
 * Response: { transaction_id, explanation }
 */
router.post('/explain', async (req, res) => {
  const {
    transaction_id,
    status,
    webhook_amount,
    settlement_amount,
    payment_method,
    discrepancy_details,
  } = req.body;

  if (!transaction_id || !status) {
    return res
      .status(400)
      .json({ error: 'transaction_id and status are required' });
  }

  const prompt = buildExplainPrompt({
    transaction_id,
    status,
    webhook_amount,
    settlement_amount,
    payment_method,
    discrepancy_details,
  });

  const result = await model.generateContent(prompt);
  const explanation = result.response.text().trim();

  console.log(`🤖 Explained: ${transaction_id} (${status})`);
  res.json({ transaction_id, explanation });
});

// ── POST /agent/summarize ─────────────────────────────────────
/**
 * Generate a natural-language summary of a full reconciliation run.
 *
 * Request body:
 * {
 *   run_id: string,
 *   total: number,
 *   matched: number,
 *   mismatched: number,
 *   missing: number,
 *   duplicate: number,
 *   total_amount_discrepancy: number,
 *   currency: string,
 *   mismatched_transactions: Array<{ transaction_id, webhook_amount, settlement_amount }>
 * }
 *
 * Response: { run_id, summary }
 */
router.post('/summarize', async (req, res) => {
  const body = req.body;

  if (!body.run_id || body.total === undefined) {
    return res
      .status(400)
      .json({ error: 'run_id and total are required' });
  }

  const prompt = buildSummarizePrompt(body);
  const result = await model.generateContent(prompt);
  const summary = result.response.text().trim();

  console.log(`🤖 Summarized run: ${body.run_id}`);
  res.json({ run_id: body.run_id, summary });
});

module.exports = router;
