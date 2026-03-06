/**
 * SAM2 实例分割 API 客户端
 * 通过本地代理请求 SAM2 服务，用于街景立面分析
 */

const SAM2_BASE = (typeof process !== 'undefined' && process.env?.VITE_SAM2_URL) || '/api/sam2';

export interface ColorRawVars {
  HueEntropy: number;
  SaturationMean: number;
  HueDiversity: number;
  NonzeroBins: number;
}

export interface Sam2SegmentResult {
  segmentation_image_base64: string;
  Transparency: number;
  SignageScale: number;
  ColorRichness: number;
  ColorRichnessRaw?: number;
  ColorRawVars?: ColorRawVars;
  HueHistogram: number[];
  StyleDescription: string;
  Reasoning: string;
}

export async function sam2Segment(imageDataUrl: string): Promise<Sam2SegmentResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(`${SAM2_BASE}/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageDataUrl }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.detail || data?.error || JSON.stringify(data);
      throw new Error(typeof msg === 'string' ? msg : msg);
    }
    return data as Sam2SegmentResult;
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('abort')) {
      throw new Error(
        'Cannot connect to SAM2. Ensure SAM2 is running: npm run sam2 (or cd sam2_server && python -m uvicorn app:app --port 3002)'
      );
    }
    throw e;
  }
}

/** 仅用 OpenCV 统计整图色彩丰富度 */
export async function sam2ColorRichness(imageDataUrl: string): Promise<number> {
  const data = await sam2ColorRichnessFull(imageDataUrl);
  return data.ColorRichness;
}

/** 色彩丰富度完整数据（含原始变量），用于导出 */
export async function sam2ColorRichnessFull(
  imageDataUrl: string
): Promise<{ ColorRichness: number; ColorRichnessRaw: number; ColorRawVars: ColorRawVars; HueHistogram: number[] }> {
  const res = await fetch(`${SAM2_BASE}/color-richness`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: imageDataUrl }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.detail || data?.error || JSON.stringify(data);
    throw new Error(typeof msg === 'string' ? msg : msg);
  }
  return data;
}
