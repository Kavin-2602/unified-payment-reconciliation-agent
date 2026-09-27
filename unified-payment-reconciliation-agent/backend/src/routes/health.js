/**
 * backend/src/routes/health.js
 * Simple health check — used by n8n and monitoring
 */

const router = require('express').Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'unified-stream-backend',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
