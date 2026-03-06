# 运行依赖说明

本项目是 **Node.js / React (TypeScript)** 项目，可完全在本地运行，不依赖 Google Studio。

**架构**：图像理解由 **SAM2**（Hugging Face Transformers）完成，图像生成由 **豆包**（火山方舟）完成。

## 本地部署（四步启动）

1. **安装依赖**
   ```bash
   npm install
   ```

2. **配置豆包 API**（图像生成）
   在项目根目录创建 `.env` 文件，参考 `.env.example` 添加：
   ```
   DOUBAO_API_KEY=你的密钥
   DOUBAO_IMAGE_ENDPOINT=图像模型接入点(ep-xxx)
   ```
   获取：火山方舟 https://console.volcengine.com/ark

3. **启动 SAM2 分割服务**（需 Python 3.10+、PyTorch）
   ```bash
   npm run sam2
   ```
   或手动：
   ```bash
   cd sam2_server && pip install -r requirements.txt && python -m uvicorn app:app --port 3002
   ```
   首次运行会下载 `facebook/sam2-hiera-base-plus` 模型。

4. **启动开发服务器**
   ```bash
   npm run dev
   ```
   会同时启动前端和豆包代理，浏览器访问：http://localhost:3000

   若遇「Failed to fetch」，可手动分步启动：
   ```bash
   # 终端 1：启动豆包代理
   npm run server
   # 终端 2：启动 SAM2（若未启动）
   npm run sam2
   # 终端 3：启动前端
   npm run dev:frontend
   ```

---

## 安装依赖

在项目根目录执行：

在项目根目录执行：

```bash
npm install
```

会根据 `package.json` 和 `package-lock.json` 安装全部依赖。

## 主要依赖一览

| 包名 | 用途 |
|------|------|
| react, react-dom | React 19 框架 |
| vite | 构建与开发服务器 |
| @vitejs/plugin-react | Vite 的 React 插件 |
| fetch (原生) | 豆包 API 调用 |
| @tailwindcss/vite, tailwindcss | Tailwind CSS v4 |
| tailwind-merge, clsx | 样式类名工具 |
| lucide-react | 图标库 |
| motion | 动画库 |
| konva, react-konva, use-image | 画布编辑（分割图） |
| react-markdown | Markdown 渲染 |
| dotenv | 环境变量 |
| express, better-sqlite3 | 服务端（若使用） |
| typescript | 开发时 TypeScript 编译 |

## 运行项目

```bash
npm run dev
```

开发服务器默认：<http://localhost:3000>

## 构建生产版本

```bash
npm run build
npm run preview   # 本地预览构建结果
```

---

如需锁定版本，请勿删除 `package-lock.json`，并始终使用 `npm install` 安装依赖。
