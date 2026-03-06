/**
 * Netlify Function: Doubao (Volcengine Ark) API proxy
 * Keeps API keys server-side, avoids CORS
 */
const ARK_BASE = 'https://ark.cn-beijing.volces.com';

export default async (req: Request): Promise<Response> => {
  const apiKey = process.env.DOUBAO_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: 'DOUBAO_API_KEY not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  // Rewrite passes :splat, so path is /.netlify/functions/doubao-proxy/chat/completions etc.
  const match = url.pathname.match(/\/doubao-proxy\/(.*)/);
  const subPath = match ? match[1] : '';
  const targetPath = `/api/v3/${subPath}`;
  const targetUrl = `${ARK_BASE}${targetPath}${url.search}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  let body: string | undefined;
  if (req.method !== 'GET' && req.body) {
    body = await req.text();
  }

  try {
    const r = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });
    const data = await r.json();
    return Response.json(data, { status: r.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Doubao proxy error:', msg);
    return Response.json({ error: msg }, { status: 502 });
  }
};
