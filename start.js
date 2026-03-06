/**
 * 同时启动代理服务器和 Vite 开发服务器
 * 用法：node start.js
 */
import { spawn } from 'child_process';

const server = spawn('node', ['server/index.js'], { stdio: 'inherit', shell: true });
const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });

[server, vite].forEach((p) => {
  p.on('error', (e) => console.error(e));
  p.on('exit', (code) => {
    if (code !== 0 && code !== null) process.exit(code);
  });
});
