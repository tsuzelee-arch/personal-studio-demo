'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');
const fs      = require('fs');


const aiRouter  = require('./server/routes/ai');
const n8nRouter = require('./server/routes/n8n');

const app  = express();
const PORT = process.env.PORT  || 3001;
const N8N  = process.env.N8N_PORT || 5678;

app.use(cors());
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
app.use('/api/ai',  aiRouter);
app.use('/api/n8n', n8nRouter);

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

app.listen(PORT, () => {
  console.log('');
  console.log('  Personal Studio — Backend Server');
  console.log(`  Express : http://localhost:${PORT}`);
  console.log(`  n8n UI  : http://localhost:${N8N}`);
  console.log(`  Health  : http://localhost:${PORT}/health`);
  console.log('');
});
