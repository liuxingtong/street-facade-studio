# Street Facade Studio

街景立面分析与生成设计工具。基于 SAM2 实例分割分析透明度、招牌尺度、色彩丰富度，结合豆包进行图像生成与变体设计。

## 在线体验

> **在线演示**：[在此填入部署后的链接，如 Railway / Netlify 地址]

---

## 本地部署

### 环境要求

- Node.js 18+
- Python 3.10+（用于 SAM2）
- [火山方舟](https://console.volcengine.com/ark) API Key（图像生成）

### 启动步骤

1. **安装依赖**
   ```bash
   npm install
   ```

2. **配置环境变量**
   
   复制 `.env.example` 为 `.env`，填入豆包配置：
   ```
   DOUBAO_API_KEY=你的密钥
   DOUBAO_IMAGE_ENDPOINT=图像模型接入点(ep-xxx)
   ```

3. **启动 SAM2 服务**（新终端）
   ```bash
   npm run sam2
   ```
   首次运行会下载 SAM2 模型，需等待数分钟。

4. **启动开发服务器**
   ```bash
   npm run dev
   ```
   浏览器访问 http://localhost:3000

### 分步启动（可选）

若 `npm run dev` 遇到问题，可手动分步启动：

```bash
# 终端 1：豆包代理
npm run server

# 终端 2：SAM2 分割服务
npm run sam2

# 终端 3：前端
npm run dev:frontend
```

---

## 项目结构

```
├── src/                 # React 前端
├── server/              # 豆包 API 代理
├── sam2_server/        # SAM2 分割与指标计算（Python）
├── netlify/             # Netlify Functions
├── DEPLOY.md            # Netlify 部署说明
└── DEPLOY-RAILWAY.md    # Railway 部署说明
```

---

## 功能说明

- **分析**：上传街景图，SAM2 分割 + OpenCV 计算透明度、招牌尺度、色彩丰富度
- **生成**：基于豆包进行立面变体生成，支持梯度调节
- **导出**：将图像、指标、提示词、模型、种子等导出为 xlsx，便于复现

---

## 线上部署

- [Netlify 部署指南](DEPLOY.md)
- [Railway 部署指南](DEPLOY-RAILWAY.md)
