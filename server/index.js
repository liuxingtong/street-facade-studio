/**
 * Doubao API proxy server
 * Keeps API keys server-side, avoids CORS
 */
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3001;
const ARK_BASE = 'https://ark.cn-beijing.volces.com';

const apiKey = process.env.DOUBAO_API_KEY?.trim();
if (!apiKey) console.warn('DOUBAO_API_KEY not set');

app.use(express.json({ limit: '50mb' }));

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

app.listen(PORT, () => {
  console.log(`Doubao proxy: http://localhost:${PORT}`);
});
