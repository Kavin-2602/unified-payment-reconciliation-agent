/**
 * backend/src/utils/errorHandler.js
 * Centralized Express error handler middleware.
 * Logs full stack traces in development, safe messages in production.
 */

function errorHandler(err, req, res, _next) {
  // Always log the full stack so backend terminal shows exactly what failed
  console.error(`\n❌ [${req.method} ${req.path}] ${err.message}`);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (err.message?.includes('Only .csv files are accepted')) {
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    // Include stack in dev so the frontend console shows the actual cause
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

module.exports = { errorHandler };
