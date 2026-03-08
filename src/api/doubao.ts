/**
 * 豆包（火山方舟）API 客户端
 * 通过本地代理请求，避免浏览器 CORS 限制
 */

const API_BASE = '/api/doubao';

export interface DoubaoConfig {
  apiKey: string;
  chatEndpoint: string;
  imageEndpoint: string;
  /** 智能路由时显式指定视觉模型，如 doubao-seed-1.6-250615 */
  visionModel?: string;
}

async function doubaoFetch<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = data?.error || data;
    const msg = typeof err === 'object' ? (err.message || JSON.stringify(err)) : String(err);
    throw new Error(msg || `请求失败: ${res.status}`);
  }
  return data as T;
}

/** 视觉理解：分析图片并返回 JSON */
export async function doubaoChatVision(
  config: DoubaoConfig,
  imageDataUrl: string,
  prompt: string,
  options?: { responseFormat?: 'json' }
): Promise<string> {
  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('无效的图片格式');
  const [, mimeType, base64] = match;

  const content: Array<{ type: string; image_url?: { url: string }; text?: string }> = [
    { type: 'image_url', image_url: { url: imageDataUrl } },
    { type: 'text', text: prompt },
  ];

  // 若配置了 visionModel，直接用模型名作为 model 值，而不是接入点 ID
  const body: Record<string, unknown> = {
    model: config.visionModel || config.chatEndpoint,
    messages: [{ role: 'user', content }],
    max_tokens: 4096,
    temperature: 0.3,
  };

  if (options?.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const res = await doubaoFetch<{ choices?: Array<{ message?: { content?: string } }> }>(
    '/chat/completions',
    body
  );

  const text = res.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI 未返回有效内容');
  return text;
}

/** 多图视觉理解（原图 + 分割图） */
export async function doubaoChatVisionMulti(
  config: DoubaoConfig,
  imageUrls: string[],
  prompt: string,
  options?: { responseFormat?: 'json' }
): Promise<string> {
  const content: Array<{ type: string; image_url?: { url: string }; text?: string }> = [];
  for (const url of imageUrls) {
    content.push({ type: 'image_url', image_url: { url } });
  }
  content.push({ type: 'text', text: prompt });

  const body: Record<string, unknown> = {
    model: config.visionModel || config.chatEndpoint,
    messages: [{ role: 'user', content }],
    max_tokens: 4096,
    temperature: 0.3,
  };

  if (options?.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const res = await doubaoFetch<{ choices?: Array<{ message?: { content?: string } }> }>(
    '/chat/completions',
    body
  );

  const text = res.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI 未返回有效内容');
  return text;
}

/** 图像生成（文生图或图生图） */
export async function doubaoImageGenerate(
  config: DoubaoConfig,
  prompt: string,
  options?: {
    /** 参考图 data URL，用于图生图 */
    image?: string;
    size?: string;
    /** 随机种子，用于结果复现（若 API 支持） */
    seed?: number;
  }
): Promise<{ imageUrl: string; seed: number }> {
  const seed = options?.seed ?? Math.floor(Math.random() * 2147483647);
  const body: Record<string, unknown> = {
    model: config.imageEndpoint,
    prompt,
    size: options?.size || '4K',
    response_format: 'b64_json',
    seed,
  };

  if (options?.image) {
    const img = options.image.trim();
    body.image = img.startsWith('data:') || img.startsWith('http') ? img : `data:image/png;base64,${img}`;
  }

  const res = await doubaoFetch<{ data?: Array<{ b64_json?: string }> }>(
    '/images/generations',
    body
  );

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('未生成图片');
  return { imageUrl: `data:image/png;base64,${b64}`, seed };
}
