'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');

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

// Serve static frontend
app.use(express.static(path.resolve(__dirname)));
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('  Personal Studio — Backend Server');
  console.log(`  Express : http://localhost:${PORT}`);
  console.log(`  n8n UI  : http://localhost:${N8N}`);
  console.log(`  Health  : http://localhost:${PORT}/health`);
  console.log('');
});
