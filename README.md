# Street Facade Studio

街景立面分析与生成设计工具。基于 **SAM2** 分割分析透明度、招牌尺度、色彩丰富度，结合豆包进行图像生成与变体设计。

---

## 本地部署

### 环境要求

- Node.js 18+
- Python 3.10+（用于 SAM2 分割）
- [火山方舟](https://console.volcengine.com/ark) API Key（图像生成，可选）
- GPU 推荐（SAM2 推理，CPU 也可运行但较慢）

### 一键启动（推荐）

```bash
npm run start:all
```

或使用 `start.bat`（Windows）自动完成依赖安装并启动全部服务，约 15 秒后打开浏览器。

访问 http://localhost:3000

### 分步启动

```bash
# 终端 1：豆包代理 + 前端
npm run dev

# 终端 2：SAM2 分割服务
npm run sam2
```

或手动分步：

```bash
npm run server        # 豆包代理（端口 3001）
npm run sam2          # SAM2 分割服务（端口 3002）
npm run dev:frontend  # 前端（端口 3000）
```

### 配置

1. 复制 `.env.example` 为 `.env`
2. 填入 `DOUBAO_API_KEY`、`DOUBAO_IMAGE_ENDPOINT` 等（图像生成需要）
3. 国内网络：SAM2 自动使用 `hf-mirror.com` 镜像下载模型（约 1GB）

---

## 项目结构

```
├── src/              # React 前端
├── server/           # 豆包 API 代理
├── sam2_server/      # SAM2 分割 + 色彩丰富度（Python）
├── scripts/          # 一键启动、批量处理
└── start.bat         # Windows 一键启动
```

---

## 功能说明

- **分析**：上传街景图，SAM2 自动分割 + 手动标注 Glass/Signboard，计算透明度、招牌尺度、色彩丰富度
- **全图可标注**：选择标签后点击区域标注；空白处点击可添加新区块（点提示分割）
- **生成**：基于豆包进行立面变体生成
- **导出**：将图像、指标、标注图、提示词等导出为 xlsx

---

## SAM2 服务

详见 [sam2_server/README.md](sam2_server/README.md)

- `POST /segment-masks`：自动分割，返回可标注 mask 列表
- `POST /segment-at-point`：点击坐标分割该区域（全图可标注）
- `POST /color-richness`：色彩丰富度
