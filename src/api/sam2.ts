/**
 * SAM2 实例分割 API 客户端
 * 通过本地代理请求 SAM2 服务，用于街景立面分析
 */

const SAM2_BASE = (typeof process !== 'undefined' && process.env?.VITE_SAM2_URL) || '/api/sam2';

export interface MaskItem {
  id: number;
  polygon: number[][];
  area: number;
  bbox: number[];
}

export interface SegmentMasksResult {
  masks: MaskItem[];
  width: number;
  height: number;
}

/** 点击任意位置分割该区域，实现全图可标注 */
export async function sam2SegmentAtPoint(
  imageDataUrl: string,
  x: number,
  y: number
): Promise<{ mask: MaskItem | null; width: number; height: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${SAM2_BASE}/segment-at-point`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageDataUrl, x: Math.round(x), y: Math.round(y) }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.detail || data?.error || JSON.stringify(data);
      throw new Error(typeof msg === 'string' ? msg : msg);
    }
    return data as { mask: MaskItem | null; width: number; height: number };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('abort')) {
      throw new Error('Cannot connect to segmentation service.');
    }
    throw e;
  }
}

export async function sam2SegmentMasks(imageDataUrl: string): Promise<SegmentMasksResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    const res = await fetch(`${SAM2_BASE}/segment-masks`, {
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
    return data as SegmentMasksResult;
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('abort')) {
      throw new Error(
        'Cannot connect to segmentation service. Ensure it is running: npm run sam2 (or cd sam2_server && python -m uvicorn app:app --port 3002)'
      );
    }
    throw e;
  }
}

export interface ColorRawVars {
  HueEntropy: number;
  SaturationMean: number;
  HueDiversity: number;
  NonzeroBins: number;
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
