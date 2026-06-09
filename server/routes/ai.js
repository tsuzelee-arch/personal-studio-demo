'use strict';
const express = require('express');
const router  = express.Router();

// Prefer x-api-key header (frontend-passed), fall back to server .env
function getKey(req, envVar) {
  return req.headers['x-api-key'] || process.env[envVar] || null;
}

async function proxy(url, opts, res, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, { ...opts, signal: controller.signal });
    const ct   = upstream.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await upstream.json() : await upstream.text();
    res.status(upstream.status).json(body);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Upstream request timed out (120s)' });
    res.status(502).json({ error: err.message });
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenAI: Chat completions (gpt-5.5, gpt-5.4, gpt-4o, etc.) ──────────────
router.post('/openai/chat', async (req, res) => {
  const key = getKey(req, 'OPENAI_API_KEY');
  if (!key) return res.status(401).json({ error: 'OpenAI API key required' });
  await proxy(
    'https://api.openai.com/v1/chat/completions',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body:    JSON.stringify(req.body)
    },
    res
  );
});

// ── OpenAI: Image generation (gpt-image-2 / DALL-E) ─────────────────────────
router.post('/openai/images', async (req, res) => {
  const key = getKey(req, 'OPENAI_API_KEY');
  if (!key) return res.status(401).json({ error: 'OpenAI API key required' });
  await proxy(
    'https://api.openai.com/v1/images/generations',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body:    JSON.stringify(req.body)
    },
    res
  );
});

// ── OpenAI: List models (connection test) ────────────────────────────────────
router.get('/openai/models', async (req, res) => {
  const key = getKey(req, 'OPENAI_API_KEY');
  if (!key) return res.status(401).json({ error: 'OpenAI API key required' });
  await proxy(
    'https://api.openai.com/v1/models',
    { headers: { Authorization: `Bearer ${key}` } },
    res
  );
});

// ── Gemini: Generate content (:model = e.g. gemini-3.5-flash) ───────────────
//   Handles text generation, vision analysis, and image generation (Nano Banana)
router.post('/gemini/:model/generate', async (req, res) => {
  const key = getKey(req, 'GEMINI_API_KEY');
  if (!key) return res.status(401).json({ error: 'Gemini API key required' });
  const model = req.params.model;
  await proxy(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body)
    },
    res
  );
});

// ── Gemini: List models (connection test) ────────────────────────────────────
router.get('/gemini/models', async (req, res) => {
  const key = getKey(req, 'GEMINI_API_KEY');
  if (!key) return res.status(401).json({ error: 'Gemini API key required' });
  await proxy(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    {},
    res
  );
});

module.exports = router;
