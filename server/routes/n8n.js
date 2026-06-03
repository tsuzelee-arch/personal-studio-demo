'use strict';
const express = require('express');
const router  = express.Router();

const n8nBase = () => `http://localhost:${process.env.N8N_PORT || 5678}`;

// ── n8n health check ─────────────────────────────────────────────────────────
router.get('/status', async (_req, res) => {
  try {
    const r = await fetch(`${n8nBase()}/healthz`);
    res.json({ running: r.ok, url: n8nBase() });
  } catch {
    res.json({ running: false, url: n8nBase(), hint: 'Run: npm run n8n' });
  }
});

// ── Forward POST to n8n webhook ───────────────────────────────────────────────
//   Usage: POST /api/n8n/webhook/<your-webhook-path>
router.post('/webhook/:path(*)', async (req, res) => {
  try {
    const upstream = await fetch(`${n8nBase()}/webhook/${req.params.path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body)
    });
    const ct   = upstream.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await upstream.json() : await upstream.text();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'n8n is not reachable', hint: 'npm run n8n', detail: err.message });
  }
});

// ── Forward GET to n8n webhook (test triggers) ───────────────────────────────
router.get('/webhook/:path(*)', async (req, res) => {
  try {
    const qs  = new URLSearchParams(req.query).toString();
    const url = `${n8nBase()}/webhook-test/${req.params.path}${qs ? '?' + qs : ''}`;
    const upstream = await fetch(url);
    const ct   = upstream.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await upstream.json() : await upstream.text();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'n8n is not reachable', detail: err.message });
  }
});

// ── Get workflow execution status ────────────────────────────────────────────
//   Requires N8N_API_KEY in .env (n8n Settings > API > Create API Key)
router.get('/execution/:id', async (req, res) => {
  try {
    const upstream = await fetch(`${n8nBase()}/api/v1/executions/${req.params.id}`, {
      headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY || '' }
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── List workflows (for the workflow editor UI) ───────────────────────────────
router.get('/workflows', async (_req, res) => {
  try {
    const upstream = await fetch(`${n8nBase()}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY || '' }
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
