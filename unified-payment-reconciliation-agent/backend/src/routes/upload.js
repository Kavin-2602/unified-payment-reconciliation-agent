/**
 * backend/src/routes/upload.js
 * Handles CSV upload for settlement data simulation
 * Accepts multipart/form-data with field name "file"
 */

const router = require('express').Router();
const multer = require('multer');
const { parse } = require('csv-parse');
const { supabase } = require('../db/supabaseClient');

// Store upload in memory (CSV files are small for MSME scale)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.endsWith('.csv')) {
      return cb(new Error('Only .csv files are accepted'));
    }
    cb(null, true);
  },
});

/**
 * POST /upload/csv
 * Body: multipart/form-data
 *   - file: <CSV file>
 *   - source: "upi" | "card" | "cash" | "bank" (defaults to "unknown")
 */
router.post('/csv', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
  }

  const source = req.body.source || 'unknown';
  const csvBuffer = req.file.buffer;

  // Parse CSV into records
  const records = await new Promise((resolve, reject) => {
    parse(csvBuffer, {
      columns: true,          // First row = headers
      skip_empty_lines: true,
      trim: true,
    }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  if (!records.length) {
    return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
  }

  // Normalize rows to match live settlement_transactions schema
  const rows = records.map((r, idx) => ({
    transaction_id:    r.transaction_id || r.txn_id || r.id || null,
    merchant_order_id: r.merchant_order_id || r.order_id || null,
    amount:            parseFloat(r.amount) || 0,
    currency:          (r.currency || 'INR').toUpperCase(),
    payment_method:    (r.payment_method || source).toLowerCase(),
    settlement_date:   r.settlement_date || r.date || null,
    source,
    // status / raw_row / row_index not in live table
    _row_index: idx + 2, // internal only, not sent to DB
  }));

  const invalidRows = rows.filter((r) => !r.transaction_id);
  if (invalidRows.length) {
    return res.status(422).json({
      error: `${invalidRows.length} rows missing transaction_id. Check columns: transaction_id, txn_id, or id.`,
      invalid_rows: invalidRows.map((r) => r._row_index),
    });
  }

  // Strip internal field before sending to Supabase
  const dbRows = rows
    .filter((r) => r.transaction_id)
    .map(({ _row_index, ...rest }) => rest);

  // Deduplicate by (transaction_id, source) before upsert
  const seen = new Map();
  for (const r of dbRows) {
    seen.set(`${r.transaction_id}::${r.source}`, r);
  }
  const deduped = [...seen.values()];

  const { error } = await supabase
    .from('settlement_transactions')
    .upsert(deduped, { onConflict: 'transaction_id,source' });

  if (error) {
    console.error('Settlement upsert error:', error);
    return res.status(500).json({ error: 'Failed to store settlement data', detail: error.message });
  }

  console.log(`📄 CSV uploaded: ${deduped.length} rows | source: ${source}`);
  res.json({
    success: true,
    source,
    rows_uploaded: deduped.length,
    rows_skipped: rows.length - deduped.length,
  });
});

module.exports = router;
