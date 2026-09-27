/**
 * backend/src/agent/geminiClient.js
 * Singleton Gemini model instance — shared by all agent routes.
 *
 * RULE: This module is used ONLY to generate natural-language text.
 * Classification logic lives in services/reconciliationEngine.js.
 * The LLM never decides a transaction's status.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    'GEMINI_API_KEY is missing from backend/.env. ' +
    'Add it before starting the server.'
  );
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
});

module.exports = { model };
