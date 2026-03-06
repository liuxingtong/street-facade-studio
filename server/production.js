/**
 * Production server: static frontend + Doubao proxy + SAM2 proxy
 * For Railway / Vercel / self-hosted
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ARK_BASE = 'https://ark.cn-beijing.volces.com';
const apiKey = process.env.DOUBAO_API_KEY?.trim();
const sam2Url = process.env.SAM2_SERVICE_URL?.trim();

if (!apiKey) console.warn('DOUBAO_API_KEY not set');
if (!sam2Url) console.warn('SAM2_SERVICE_URL not set - analysis will fail');

app.use(express.json({ limit: '50mb' }));

// Doubao API proxy
app.all('/api/doubao/*', async (req, res) => {
  if (!apiKey) return res.status(500).json({ error: 'DOUBAO_API_KEY not configured' });
  const path = req.path.replace('/api/doubao', '/api/v3');
  const url = `${ARK_BASE}${path}`;
  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(req.headers['content-type'] && { 'Content-Type': req.headers['content-type'] }),
    };
    const opts = { method: req.method, headers };
    if (req.method !== 'GET' && req.body) opts.body = JSON.stringify(req.body);
    const r = await fetch(url, opts);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('Doubao error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// SAM2 proxy (when SAM2_SERVICE_URL is set)
app.all('/api/sam2/*', async (req, res) => {
  if (!sam2Url) return res.status(503).json({ error: 'SAM2_SERVICE_URL not configured' });
  const path = req.path.replace(/^\/api\/sam2/, '') || '/';
  const targetUrl = `${sam2Url.replace(/\/$/, '')}${path}`;
  try {
    const opts = { method: req.method, headers: { 'Content-Type': 'application/json' } };
    if (req.method !== 'GET' && req.body) opts.body = JSON.stringify(req.body);
    const r = await fetch(targetUrl, opts);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('SAM2 proxy error:', e.message);
    res.status(502).json({ error: 'SAM2 service unavailable' });
  }
});

// Static frontend (must be last)
app.use(express.static(join(__dirname, '../dist')));
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  if (sam2Url) console.log('SAM2 proxy:', sam2Url);
});
