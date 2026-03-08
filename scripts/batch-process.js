/**
 * 批量处理脚本：底图 + 提示词 → 生成图 → 保存图片 + 色彩丰富度 → 导出 xlsx
 * 不依赖前端，直接调用 3001（Doubao 代理）和 3002（色彩丰富度）
 *
 * 用法：
 *   1. 确保 server (3001) 和 sam2_server (3002) 已启动
 *   2. node scripts/batch-process.js
 *
 * 输入：F:\Aworks\HFE2\baseimage\1.png, 2.png, 3.png
 *       prompt.txt（每行一条提示词）
 * 输出：F:\Aworks\HFE2\newimage\
 *       - 图片：{底图名}-{提示词编号}-{生成序号}.png（如 1-lSlWlR-1.png）
 *       - xlsx：{底图名}-{提示词编号}-{生成序号}.xlsx
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const BASE_IMAGE_DIR = 'F:\\Aworks\\HFE2\\baseimage';
const OUTPUT_DIR = 'F:\\Aworks\\HFE2\\newimage';
const PROMPT_FILE = path.join(process.cwd(), 'prompt.txt');
const DOUBAO_URL = 'http://localhost:3001/api/doubao/images/generations';
const COLOR_RICHNESS_URL = 'http://localhost:3002/color-richness';

/**
 * 解析 prompt.txt，返回 [{ id, prompt }]
 * 支持格式：
 *   1. lSlWlR: As a talented architect...  （编号 lSlWlR 用于文件名，冒号后为提示词内容）
 *   lSlWlR	As a talented architect...    （Tab 分隔）
 *   As a talented architect...             （无编号时用行号 1,2,3...）
 */
function readPrompts() {
  if (!fs.existsSync(PROMPT_FILE)) {
    throw new Error(`prompt.txt 不存在: ${PROMPT_FILE}`);
  }
  const text = fs.readFileSync(PROMPT_FILE, 'utf-8');
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('prompt.txt 为空');
  return lines.map((line, i) => {
    // 格式: "1. lSlWlR: 提示词内容" 或 "lSlWlR: 提示词内容"
    const colonMatch = line.match(/^(?:\d+\.\s*)?([^:]+):\s*(.+)$/s);
    if (colonMatch) {
      return { id: colonMatch[1].trim(), prompt: colonMatch[2].trim() };
    }
    const tabIdx = line.indexOf('\t');
    if (tabIdx > 0) {
      return { id: line.slice(0, tabIdx).trim(), prompt: line.slice(tabIdx + 1).trim() };
    }
    return { id: String(i + 1), prompt: line };
  });
}

function readImageAsDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const base64 = buf.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${base64}`;
}

async function generateImage(imageEndpoint, prompt, baseImageDataUrl, seed) {
  const body = {
    model: imageEndpoint,
    prompt,
    size: '4K',
    response_format: 'b64_json',
    seed: seed ?? Math.floor(Math.random() * 2147483647),
    image: baseImageDataUrl,
  };
  const res = await fetch(DOUBAO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Doubao: ${data?.error || JSON.stringify(data)}`);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('Doubao 未返回图片');
  return { imageUrl: `data:image/png;base64,${b64}`, seed: body.seed };
}

async function getColorRichness(imageDataUrl) {
  const res = await fetch(COLOR_RICHNESS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: imageDataUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`ColorRichness: ${data?.detail || data?.error || JSON.stringify(data)}`);
  return data;
}

function dataUrlToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  const base64 = match ? match[1] : dataUrl;
  return Buffer.from(base64, 'base64');
}

function getImageExt(dataUrl) {
  const match = dataUrl.match(/^data:image\/(\w+);/);
  const mime = match ? match[1].toLowerCase() : 'png';
  return mime === 'jpeg' ? 'jpeg' : 'png';
}

async function exportToXlsxFile(data, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Facade Studio Batch';
  wb.created = new Date();
  const ws = wb.addWorksheet('Facade Run', { properties: { defaultColWidth: 24 } });
  const rv = data.metrics?.ColorRawVars;
  const rows = [
    ['Timestamp', data.timestamp],
    ['Image', '(embedded below)'],
    ['', ''],
    ['--- Metrics ---', ''],
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
    const buffer = dataUrlToBuffer(data.imageDataUrl);
    const ext = getImageExt(data.imageDataUrl);
    const imgId = wb.addImage({ buffer, extension: ext });
    ws.addImage(imgId, { tl: { col: 0, row: imageStartRow }, ext: { width: 400, height: 300 } });
  } catch (e) {
    ws.getCell(imageStartRow + 1, 1).value = '(Image embed failed)';
  }
  await wb.xlsx.writeFile(filePath);
}

async function main() {
  const imageEndpoint = process.env.DOUBAO_IMAGE_ENDPOINT?.trim();
  if (!imageEndpoint) {
    console.error('请配置 .env 中的 DOUBAO_IMAGE_ENDPOINT');
    process.exit(1);
  }

  if (!fs.existsSync(BASE_IMAGE_DIR)) {
    console.error(`底图目录不存在: ${BASE_IMAGE_DIR}`);
    process.exit(1);
  }

  const prompts = readPrompts();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`提示词: ${prompts.length} 条`);
  console.log(`输出目录: ${OUTPUT_DIR}\n`);

  const baseFiles = ['1.png', '2.png', '3.png'];
  let total = 0;
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const baseFile of baseFiles) {
    const basePath = path.join(BASE_IMAGE_DIR, baseFile);
    if (!fs.existsSync(basePath)) {
      console.warn(`跳过（文件不存在）: ${basePath}`);
      continue;
    }

    const baseName = path.basename(baseFile, path.extname(baseFile));
    const baseImageDataUrl = readImageAsDataUrl(basePath);
    console.log(`\n=== 底图: ${baseFile} ===`);

    for (let pIdx = 0; pIdx < prompts.length; pIdx++) {
      const { id: promptId, prompt } = prompts[pIdx];
      console.log(`  提示词 ${promptId}/${prompts.length}`);

      for (let gIdx = 0; gIdx < 3; gIdx++) {
        const genIdx = gIdx + 1;
        const safeId = String(promptId).replace(/[/\\]/g, '_');
        const baseName2 = `${baseName}-${safeId}-${genIdx}`;
        const pngPath = path.join(OUTPUT_DIR, `${baseName2}.png`);
        const xlsxPath = path.join(OUTPUT_DIR, `${baseName2}.xlsx`);
        total++;

        if (fs.existsSync(pngPath)) {
          skipped++;
          console.log(`    - ${baseName2} 已存在，跳过`);
          continue;
        }

        try {
          const { imageUrl, seed } = await generateImage(imageEndpoint, prompt, baseImageDataUrl);
          fs.writeFileSync(pngPath, dataUrlToBuffer(imageUrl));

          const crData = await getColorRichness(imageUrl);
          await exportToXlsxFile(
            {
              imageDataUrl: imageUrl,
              timestamp: new Date().toISOString(),
              metrics: {
                ColorRichness: crData.ColorRichness,
                ColorRichnessRaw: crData.ColorRichnessRaw,
                ColorRawVars: crData.ColorRawVars,
              },
              generation: { prompt, model: imageEndpoint, seed },
            },
            xlsxPath
          );
          ok++;
          console.log(`    ✓ ${baseName2}.png / .xlsx  ColorRichness=${crData.ColorRichness ?? '-'}`);
        } catch (e) {
          fail++;
          console.error(`    ✗ ${baseName2}: ${e.message}`);
        }
      }
    }
  }

  console.log(`\n完成: ${ok}/${total} 成功, ${fail} 失败, ${skipped} 跳过（已存在）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
