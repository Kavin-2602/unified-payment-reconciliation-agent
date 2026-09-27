/**
 * backend/src/routes/reconcile.js
 * Reconciliation trigger, results, and AI report endpoints.
 *
 * Phase 4 additions:
 *  - GET /results?explain=true   → attach AI explanation to each discrepancy row
 *  - GET /runs/:runId/report     → generate (or fetch cached) NL run summary
 */

'use strict';

const router = require('express').Router();
const { supabase }     = require('../db/supabaseClient');
const { executeRun }   = require('../reconcile/runner');
const { explainResult } = require('../agent/explainer');
const { summarizeRun }  = require('../agent/summarizer');

// Status values that warrant an AI explanation
const EXPLAINABLE_STATUSES = new Set(['MISMATCHED', 'MISSING', 'DUPLICATE']);

// ── POST /reconcile/run ───────────────────────────────────────────────────────
/**
 * Trigger a new reconciliation run.
 * Optional query param: ?triggered_by=webhook|scheduled|manual (default: manual)
 */
router.post('/run', async (req, res) => {
  const triggeredBy = req.query.triggered_by || req.body?.triggered_by || 'manual';

  const runResult = await executeRun({ triggeredBy });

  res.json({
    run_id:          runResult.run_id,
    status:          runResult.status,
    summary:         runResult.summary,
    results_preview: runResult.results.slice(0, 50),
  });
});

// ── GET /reconcile/runs ───────────────────────────────────────────────────────
/**
 * List all reconciliation runs, newest first.
 */
router.get('/runs', async (_req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_runs')
    .select('*')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ runs: data });
});

// ── GET /reconcile/runs/:runId ────────────────────────────────────────────────
/**
 * Get a specific run's aggregate summary by run_id.
 */
router.get('/runs/:runId', async (req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_runs')
    .select('*')
    .eq('run_id', req.params.runId)
    .single();

  if (error) return res.status(404).json({ error: 'Run not found' });
  res.json(data);
});

// ── GET /reconcile/runs/:runId/report ─────────────────────────────────────────
/**
 * Generate (or return cached) AI natural-language report for a run.
 *
 * Flow:
 *  1. Check if a report already exists in reconciliation_reports → return it.
 *  2. If not, fetch the run's aggregate row, call summarizeRun(), persist, return.
 *
 * This means the first call generates + persists; subsequent calls return the cache.
 */
router.get('/runs/:runId/report', async (req, res) => {
  const { runId } = req.params;

  // 1. Return cached report if it exists
  const { data: cached } = await supabase
    .from('reconciliation_reports')
    .select('*')
    .eq('run_id', runId)
    .single();

  if (cached) {
    return res.json({ run_id: runId, summary: cached.summary, cached: true });
  }

  // 2. Fetch the run aggregate
  const { data: runRow, error: runErr } = await supabase
    .from('reconciliation_runs')
    .select('*')
    .eq('run_id', runId)
    .single();

  if (runErr || !runRow) {
    return res.status(404).json({ error: `Run '${runId}' not found` });
  }

  if (runRow.status !== 'completed') {
    return res.status(409).json({
      error: `Run is in status '${runRow.status}' — report can only be generated for completed runs`,
    });
  }

  // 3. Generate with Gemini and persist
  const report = await summarizeRun(runRow);

  res.json({ run_id: runId, summary: report.summary, cached: false });
});

// ── GET /reconcile/results ────────────────────────────────────────────────────
/**
 * Returns reconciliation results.
 *
 * Query params:
 *   ?run_id=run_xyz          — filter by specific run
 *   ?status=MISMATCHED       — filter by status (MATCHED|MISMATCHED|MISSING|DUPLICATE)
 *   ?limit=100               — max rows (default 200)
 *   ?explain=true            — attach Gemini NL explanation to each discrepancy row
 *                              (only for MISMATCHED/MISSING/DUPLICATE; skipped for MATCHED)
 *                              WARNING: adds one Gemini API call per discrepancy row.
 *                              Use ?explain=true&status=MISMATCHED&limit=5 in dev.
 */
router.get('/results', async (req, res) => {
  const { run_id, status, limit = 200, explain } = req.query;
  const withExplanations = explain === 'true';

  let query = supabase
    .from('reconciliation_results')
    .select('*')
    .order('run_id', { ascending: false })
    .limit(Number(limit));

  if (run_id) query = query.eq('run_id', run_id);
  if (status) query = query.eq('status', status.toUpperCase());

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];

  // Counts breakdown (always returned)
  const counts = rows.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; },
    {}
  );

  if (!withExplanations) {
    return res.json({ total: rows.length, counts, results: rows });
  }

  // ── Attach AI explanations to discrepancy rows ─────────────────────────────
  // Fire calls concurrently but cap at 5 parallel Gemini requests to avoid
  // rate-limit errors (Gemini Flash free tier: 15 req/min).
  const CONCURRENCY = 5;
  const enriched = [...rows];

  const discrepancyIndices = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => EXPLAINABLE_STATUSES.has(r.status));

  console.log(`🤖 Generating explanations for ${discrepancyIndices.length} discrepancy rows...`);

  for (let offset = 0; offset < discrepancyIndices.length; offset += CONCURRENCY) {
    const batch = discrepancyIndices.slice(offset, offset + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ r, i }) => {
        try {
          const { explanation, recommended_action } = await explainResult(r);
          enriched[i] = { ...r, ai_explanation: explanation, recommended_action };

          // Persist explanation back to DB (best-effort, don't fail the request)
          supabase
            .from('reconciliation_results')
            .update({ ai_explanation: explanation })
            .eq('id', r.id)
            .then(({ error: e }) => {
              if (e) console.warn(`  Could not persist explanation for ${r.id}: ${e.message}`);
            });

        } catch (err) {
          console.warn(`  ⚠️  Explanation failed for ${r.transaction_id}: ${err.message}`);
          enriched[i] = {
            ...r,
            ai_explanation: null,
            ai_explanation_error: err.message,
          };
        }
      })
    );
  }

  res.json({ total: enriched.length, counts, results: enriched });
});

// ── GET /reconcile/results/:id ────────────────────────────────────────────────
/**
 * Returns a single reconciliation result by UUID.
 * Add ?explain=true to generate an AI explanation on-demand.
 */
router.get('/results/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_results')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Result not found' });

  if (req.query.explain === 'true' && EXPLAINABLE_STATUSES.has(data.status)) {
    const { explanation, recommended_action } = await explainResult(data);

    // Persist best-effort
    supabase
      .from('reconciliation_results')
      .update({ ai_explanation: explanation })
      .eq('id', data.id)
      .then(() => {});

    return res.json({ ...data, ai_explanation: explanation, recommended_action });
  }

  res.json(data);
});

// ── GET /reconcile/report ─────────────────────────────────────────────────────
/**
 * Returns the latest AI-generated natural-language report (across all runs).
 */
router.get('/report', async (_req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    return res.status(404).json({
      error: 'No reports found. Call GET /reconcile/runs/:runId/report to generate one.',
    });
  }

  res.json(data);
});

module.exports = router;
