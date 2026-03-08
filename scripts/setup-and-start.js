#!/usr/bin/env node
/**
 * 一键完成：安装依赖、配置 .env、启动全部服务
 * 用法：npm run start:all
 *
 * SegFormer 模型在首次推理时自动从 HuggingFace 下载，无需手动操作。
 */
import { spawn, execSync } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SAM2 = join(ROOT, 'sam2_server');

function runSync(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', shell: true, cwd: opts.cwd || ROOT });
}

async function main() {
  console.log('\n=== Street Facade 一键启动 ===\n');

  // 1. npm install
  if (!existsSync(join(ROOT, 'node_modules'))) {
    console.log('[1/4] npm install...');
    runSync('npm install');
  } else {
    console.log('[1/4] node_modules 已存在，跳过');
  }

  // 2. Python 依赖
  console.log('[2/4] 安装 Python 依赖...');
  runSync('pip install -r requirements.txt', { cwd: SAM2 });

  // 3. .env
  const envExample = join(ROOT, '.env.example');
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath) && existsSync(envExample)) {
    console.log('[3/4] 复制 .env.example -> .env（请填入 DOUBAO_API_KEY）');
    copyFileSync(envExample, envPath);
  } else {
    console.log('[3/4] .env 已存在');
  }

  // 4. 启动服务
  console.log('[4/4] 启动服务...\n');
  const childEnv = { ...process.env };
  if (!childEnv.HF_ENDPOINT) childEnv.HF_ENDPOINT = 'https://hf-mirror.com';

  const opts = { stdio: 'inherit', cwd: ROOT, env: childEnv };
  const server = spawn('node', ['server/index.js'], opts);
  const vite   = spawn('npx',  ['vite'], opts);
  const seg    = spawn('python', ['-m', 'uvicorn', 'app:app', '--port', '3002', '--host', '127.0.0.1'], {
    ...opts, cwd: SAM2,
  });

  const children = [server, vite, seg];

  function killAll() {
    children.forEach((p) => {
      if (p && p.pid && !p.killed) {
        try {
          p.kill('SIGTERM');
          if (process.platform === 'win32') {
            execSync(`taskkill /PID ${p.pid} /T /F 2>nul`, { stdio: 'ignore', windowsHide: true });
          }
        } catch (_) {}
      }
    });
    process.exit(0);
  }

  process.on('SIGINT', killAll);
  process.on('SIGTERM', killAll);

  children.forEach((p) => {
    p.on('error', (e) => console.error(e));
    p.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        killAll();
      }
    });
  });

  console.log('  豆包代理: http://localhost:3001');
  console.log('  分割服务: http://localhost:3002');
  console.log('  前    端: http://localhost:3000');
  console.log('\n  (首次推理时 SegFormer 自动下载模型约 370MB)\n');
  console.log('按 Ctrl+C 停止全部服务\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
