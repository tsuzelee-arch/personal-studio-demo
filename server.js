'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');
const fs      = require('fs');


const aiRouter         = require('./server/routes/ai');
const n8nRouter        = require('./server/routes/n8n');
const localAssetsRouter = require('./server/routes/localAssets');

const app  = express();
const PORT = process.env.PORT  || 3001;
const N8N  = process.env.N8N_PORT || 5678;
// Bind to loopback by default so the file-system API isn't reachable from the LAN.
// Override with HOST=0.0.0.0 only if you deliberately need remote access.
const HOST = process.env.HOST || '127.0.0.1';

// ── Security ──────────────────────────────────────────────────────────────────
// The frontend is served from this same origin (http://localhost:PORT), so the
// only legitimate API callers are same-origin. The local-assets API can read and
// write files on disk, so we must reject cross-origin calls from arbitrary
// websites (CSRF / DNS-rebinding). We restrict CORS to local origins and add an
// explicit Origin guard on the file-system routes.
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
]);

// Allow same-origin / non-browser requests (no Origin header) and whitelisted
// local origins; for anything else, omit CORS headers so the browser blocks reads.
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin)),
}));

// Hard-block (403) cross-origin requests to filesystem routes. Browser fetch()
// always sends an Origin header cross-origin, so a foreign site cannot reach
// /save or /config; same-origin GETs (no Origin) and <img> loads still pass.
function requireLocalOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Cross-origin request rejected' });
  }
  next();
}

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    uptime:    Math.round(process.uptime()),
    n8nUrl:    `http://localhost:${N8N}`,
    timestamp: new Date().toISOString()
  });
});

// API
app.use('/api/ai',           aiRouter);
app.use('/api/n8n',          n8nRouter);
app.use('/api/local-assets', requireLocalOrigin, localAssetsRouter);

// Serve static frontend — only expose specific subdirectories, not the project root
app.use('/js',     express.static(path.join(__dirname, 'js')));
app.use('/css',    express.static(path.join(__dirname, 'css')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Serve index.html with build timestamp injected for automatic cache busting on restart
const _indexPath = path.resolve(__dirname, 'index.html');
let _indexTemplate = '';
try { _indexTemplate = fs.readFileSync(_indexPath, 'utf8'); } catch (e) {}

app.get('*', (_req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    _indexTemplate = fs.readFileSync(_indexPath, 'utf8');
  }
  const dynamicHtml = _indexTemplate.replaceAll('__BUILD_TS__', Date.now());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(dynamicHtml);
});

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Personal Studio — Backend Server');
  console.log(`  Express : http://localhost:${PORT}  (bound to ${HOST})`);
  console.log(`  n8n UI  : http://localhost:${N8N}`);
  console.log(`  Health  : http://localhost:${PORT}/health`);
  console.log('');
});
