/**
 * Export facade analysis/generation data to xlsx for reproducibility
 */
import ExcelJS from 'exceljs';

export interface ExportData {
  /** Current image (data URL) - the analyzed or generated image */
  imageDataUrl: string;
  /** ISO timestamp of the run */
  timestamp: string;
  /** Metrics from SAM2 analysis */
  metrics?: {
    Transparency: number;
    SignageScale: number;
    ColorRichness: number;
    ColorRichnessRaw?: number;
    ColorRawVars?: { HueEntropy: number; SaturationMean: number; HueDiversity: number; NonzeroBins: number };
  };
  /** Generation metadata (when from image generation) */
  generation?: {
    prompt: string;
    model: string;
    seed: number;
  };
}

function base64ToArrayBuffer(dataUrl: string): { buffer: ArrayBuffer; ext: string } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  const ext = match ? (match[1] === 'jpeg' ? 'jpeg' : match[1]) : 'png';
  const base64 = match ? match[2] : dataUrl;
  const binary = atob(base64);
  const ab = new ArrayBuffer(binary.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return { buffer: ab, ext };
}

export async function exportToXlsx(data: ExportData, filename?: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Facade Studio';
  wb.created = new Date();

  const ws = wb.addWorksheet('Facade Run', { properties: { defaultColWidth: 24 } });

  const rv = data.metrics?.ColorRawVars;
  const rows: [string, string | number][] = [
    ['Timestamp', data.timestamp],
    ['Image', '(embedded below)'],
    ['', ''],
    ['--- Metrics ---', ''],
    ['Transparency', data.metrics?.Transparency ?? ''],
    ['SignageScale', data.metrics?.SignageScale ?? ''],
    ['ColorRichness', data.metrics?.ColorRichness ?? ''],
    ['ColorRichnessRaw (pre-transform)', data.metrics?.ColorRichnessRaw ?? ''],
    ['', ''],
    ['--- Color Richness Raw Vars ---', ''],
    ['HueEntropy (色相熵)', rv?.HueEntropy ?? ''],
    ['SaturationMean (饱和度均值)', rv?.SaturationMean ?? ''],
    ['HueDiversity (色相多样性)', rv?.HueDiversity ?? ''],
    ['NonzeroBins (非零色相bin数)', rv?.NonzeroBins ?? ''],
    ['', ''],
    ['--- Generation ---', ''],
    ['Prompt', data.generation?.prompt ?? ''],
    ['Model', data.generation?.model ?? ''],
    ['Seed', data.generation?.seed ?? ''],
  ];

  ws.addRows(rows);
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 60;

  const imageStartRow = rows.length;
  try {
    const { buffer, ext } = base64ToArrayBuffer(data.imageDataUrl);
    const imgId = wb.addImage({
      buffer,
      extension: ext as 'png' | 'jpeg' | 'gif',
    });
    ws.addImage(imgId, {
      tl: { col: 0, row: imageStartRow },
      ext: { width: 400, height: 300 },
    });
  } catch (e) {
    console.warn('Could not embed image:', e);
    ws.getCell(imageStartRow + 1, 1).value = '(Image embed failed)';
  }

  const blob = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `facade-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
