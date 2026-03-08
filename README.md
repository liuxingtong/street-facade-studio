# Street Facade Studio

街景立面分析与生成设计工具。基于 MIT ADE20K 语义分割分析透明度、招牌尺度、色彩丰富度，结合豆包进行图像生成与变体设计。

## 在线体验

> **在线演示**：[在此填入部署后的链接，如 Railway / Netlify 地址]

---

## 本地部署

### 环境要求

- Node.js 18+
- Python 3.10+（用于 ADE20K 分割）
- [火山方舟](https://console.volcengine.com/ark) API Key（图像生成）

### 一键启动（推荐）

```bash
npm run start:all
```

会自动完成：`npm install`、Python 依赖、ADE20K 权重下载、`.env` 配置，并启动豆包代理、分割服务、前端。浏览器访问 http://localhost:3000

**若 mit_semseg 已本地克隆**，先设置环境变量再运行：
```bash
set MIT_SEMSEG_PATH=C:\path\to\semantic-segmentation-pytorch
npm run start:all
```

### 分步启动（可选）

```bash
# 终端 1：豆包代理 + 前端
npm run dev

# 终端 2：分割服务（ADE20K）
npm run sam2
```

或手动分步：
```bash
npm run server    # 豆包代理
npm run sam2      # 分割服务
npm run dev:frontend  # 前端
```

---

## 项目结构

```
├── src/                 # React 前端
├── server/              # 豆包 API 代理
├── sam2_server/        # ADE20K 分割与指标计算（Python）
├── netlify/             # Netlify Functions
├── DEPLOY.md            # Netlify 部署说明
└── DEPLOY-RAILWAY.md    # Railway 部署说明
```

---

## 功能说明

- **分析**：上传街景图，ADE20K 分割 + OpenCV 计算透明度、招牌尺度、色彩丰富度
- **生成**：基于豆包进行立面变体生成，支持梯度调节
- **导出**：将图像、指标、提示词、模型、种子等导出为 xlsx，便于复现

---

## 线上部署

- [Netlify 部署指南](DEPLOY.md)
- [Railway 部署指南](DEPLOY-RAILWAY.md)
