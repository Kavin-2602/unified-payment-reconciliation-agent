/**
 * backend/src/index.js
 * Unified Stream — Express entry point
 */

require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors    = require('cors');

// ── 1. Startup env validation ────────────────────────────────────────────────
const REQUIRED_VARS = {
  SUPABASE_URL:              'your Supabase project URL (e.g. https://xyz.supabase.co)',
  GEMINI_API_KEY:            'your Google AI Studio API key',
};

const PLACEHOLDER_PATTERNS = [
  'your-project', 'your_supabase', 'your_gemini', 'placeholder', 'change_me',
];

const envErrors = [];
for (const [key, hint] of Object.entries(REQUIRED_VARS)) {
  const val = process.env[key];
  if (!val) {
    envErrors.push(`  ✗ ${key} is missing  →  ${hint}`);
  } else if (PLACEHOLDER_PATTERNS.some((p) => val.includes(p))) {
    envErrors.push(`  ✗ ${key} still has a placeholder value ("${val.slice(0, 40)}…")`);
  }
}

// Supabase key: need either SERVICE_ROLE_KEY or ANON_KEY (at least one real value)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseKey || PLACEHOLDER_PATTERNS.some((p) => supabaseKey.includes(p))) {
  envErrors.push('  ✗ SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) is missing/placeholder');
}

if (envErrors.length > 0) {
  console.error('\n❌ STARTUP FAILED — missing or unconfigured environment variables:');
  envErrors.forEach((e) => console.error(e));
  console.error('\n  Fix backend/.env then restart the server.\n');
  process.exit(1);   // Hard stop — do not serve broken responses
}

// Warn if using anon key in service role slot (RLS may block writes)
const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (srvKey && srvKey === process.env.SUPABASE_ANON_KEY) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY is set to the anon key.');
  console.warn('   For writes, disable RLS on your tables OR use the real service_role key.');
  console.warn('   Get it: Supabase Dashboard → Project Settings → API → service_role');
}

console.log('✅ Env vars: SUPABASE_URL ✓  Supabase key ✓  GEMINI_API_KEY ✓');
console.log(`   [DEBUG] Runtime SUPABASE_URL: "${process.env.SUPABASE_URL}"`);
const activeKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
console.log(`   [DEBUG] Runtime Supabase Key length: ${activeKey.length}, prefix: "${activeKey.slice(0, 6)}...", suffix: "...${activeKey.slice(-6)}"`);
const webhookRoutes  = require('./routes/webhook');
const uploadRoutes   = require('./routes/upload');
const reconcileRoutes = require('./routes/reconcile');
const agentRoutes    = require('./routes/agent');
const healthRoutes   = require('./routes/health');
const { supabase }   = require('./db/supabaseClient');
const { errorHandler } = require('./utils/errorHandler');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Raw body needed for Dodo webhook signature verification
app.use('/webhooks', express.raw({ type: 'application/json' }));

// JSON body for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/webhooks',  webhookRoutes);
app.use('/upload',    uploadRoutes);
app.use('/reconcile', reconcileRoutes);
app.use('/agent',     agentRoutes);      // NL explanations + summaries (Gemini)
app.use('/health',    healthRoutes);

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start + table probe ───────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅ Unified Stream backend running on http://localhost:${PORT}`);
  console.log(`   Gemini model: ${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}`);
  console.log('   Routes: /webhooks /upload /reconcile /agent /health');

  // 3. Probe Supabase — confirms the schema has been applied and the
  //    credentials are live (not just syntactically valid).
  try {
    const { error } = await supabase
      .from('reconciliation_runs')
      .select('id')
      .limit(1);

    if (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.error('\n⚠️  DB PROBE FAILED — table "reconciliation_runs" not found.');
        console.error('   Run data/schemas/supabase_schema.sql in your Supabase SQL editor.');
        console.error('   Dashboard → SQL Editor → paste the file → Run.\n');
      } else {
        console.error(`\n⚠️  DB PROBE ERROR: ${error.message} (code: ${error.code})\n`);
      }
    } else {
      console.log('   Supabase: reconciliation_runs table found ✓');
    }
  } catch (e) {
    console.error(`\n⚠️  Supabase connectivity failed: ${e.message}`);
    console.error('   Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env\n');
  }
});

module.exports = app;
