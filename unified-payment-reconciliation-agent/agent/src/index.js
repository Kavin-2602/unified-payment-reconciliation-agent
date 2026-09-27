/**
 * agent/src/index.js
 * Unified Stream — AI Agent service (Gemini)
 *
 * RULE: This service NEVER makes classification decisions.
 * It receives pre-computed reconciliation results from the backend
 * and generates natural-language explanations and summaries only.
 */

require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Gemini client ─────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is required in agent/.env');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
});

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Health ────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'unified-stream-agent',
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    timestamp: new Date().toISOString(),
  });
});

// ── POST /explain ─────────────────────────────────────────────
/**
 * Explain a single discrepancy in natural language.
 *
 * Request body:
 * {
 *   transaction_id: string,
 *   status: "MISMATCHED" | "MISSING" | "DUPLICATE",
 *   webhook_amount: number | null,
 *   settlement_amount: number | null,
 *   payment_method: string,
 *   discrepancy_details: object   // pre-computed by the engine
 * }
 *
 * Response:
 * { explanation: string }
 */
app.post('/explain', async (req, res) => {
  const {
    transaction_id,
    status,
    webhook_amount,
    settlement_amount,
    payment_method,
    discrepancy_details,
  } = req.body;

  if (!transaction_id || !status) {
    return res.status(400).json({ error: 'transaction_id and status are required' });
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

  res.json({ transaction_id, explanation });
});

// ── POST /summarize ───────────────────────────────────────────
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
 * Response:
 * { run_id, summary: string }
 */
app.post('/summarize', async (req, res) => {
  const body = req.body;

  if (!body.run_id || body.total === undefined) {
    return res.status(400).json({ error: 'run_id and total are required' });
  }

  const prompt = buildSummarizePrompt(body);
  const result = await model.generateContent(prompt);
  const summary = result.response.text().trim();

  res.json({ run_id: body.run_id, summary });
});

// ── Prompt builders ───────────────────────────────────────────

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

function buildSummarizePrompt(data) {
  const mismatchList = (data.mismatched_transactions || [])
    .slice(0, 5)
    .map((t) => `  - ${t.transaction_id}: webhook ₹${t.webhook_amount} vs settlement ₹${t.settlement_amount}`)
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

// ── Error handler ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Agent error:', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🤖 Unified Stream AI agent running on http://localhost:${PORT}`);
  console.log(`   Model: ${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}`);
});

module.exports = app;
