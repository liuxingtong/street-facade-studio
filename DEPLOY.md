# 部署指南：Netlify

本文档说明如何将 Street Facade 项目打包并部署到 Netlify。

## 一、本地打包

```bash
# 安装依赖
npm install

# 构建
npm run build
```

构建产物在 `dist/` 目录。

## 二、Netlify 部署

### 方式 A：通过 Git 连接（推荐）

1. 将项目推送到 GitHub / GitLab / Bitbucket
2. 登录 [Netlify](https://app.netlify.com)
3. 点击 **Add new site** → **Import an existing project**
4. 选择仓库，配置如下：

| 配置项 | 值 |
|-------|-----|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |

5. 在 **Site settings** → **Environment variables** 中添加：

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `DOUBAO_API_KEY` | 火山方舟 API Key | ✅ |
| `DOUBAO_IMAGE_ENDPOINT` | 图像生成接入点 ID | ✅ |
| `VITE_SAM2_URL` | SAM2 服务地址（见下方） | 视情况 |

6. 保存并触发部署

### 方式 B：拖拽部署（仅前端）

1. 本地执行 `npm run build`
2. 登录 Netlify，进入 **Sites** → **Add new site** → **Deploy manually**
3. 将 `dist` 文件夹拖入页面

注意：拖拽部署不会包含 Netlify Functions，豆包图像生成将不可用，需通过 Git 连接部署。

---

## 三、SAM2 服务说明

SAM2 是 Python 后端，依赖 GPU/CPU 推理，**无法在 Netlify 上运行**。可选方案：

### 选项 1：单独部署 SAM2

将 `sam2_server/` 部署到支持 Python 的平台，例如：

- **Railway**：支持 Docker，适合部署 Python 服务
- **Render**：支持 Web Service
- **Fly.io**：支持 Docker
- **自有 VPS**：`cd sam2_server && uvicorn app:app --host 0.0.0.0 --port 8080`

部署完成后，在 Netlify 环境变量中设置：

```
VITE_SAM2_URL=https://你的sam2服务地址
```

例如：`VITE_SAM2_URL=https://street-facade-sam2.railway.app`（末尾不要加 `/`）

### 选项 2：不部署 SAM2

不设置 `VITE_SAM2_URL` 时，前端会请求 `/api/sam2`，在 Netlify 上会 404。用户仍可使用：

- 豆包图像生成（若已配置 `DOUBAO_*`）
- 导出 xlsx（会调用 color-richness，同样依赖 SAM2）

因此，若希望分析功能可用，需要单独部署 SAM2 并配置 `VITE_SAM2_URL`。

---

## 四、环境变量汇总

| 变量 | 用途 | 生效位置 |
|------|------|----------|
| `DOUBAO_API_KEY` | 豆包 API 密钥 | Netlify Function（服务端） |
| `DOUBAO_IMAGE_ENDPOINT` | 图像生成接入点 | 构建时注入前端 |
| `VITE_SAM2_URL` | SAM2 服务地址 | 构建时注入前端 |

`VITE_` 前缀的变量会在构建时写入前端，部署后无法通过 Netlify 界面修改，需重新构建。

---

## 五、限制与注意事项

1. **请求体大小**：Netlify Functions 单次请求约 6MB 限制，大图可能失败
2. **超时**：函数执行约 60 秒超时，SAM2 分析若较慢可能超时
3. **CORS**：若 SAM2 部署在其它域名，需在 SAM2 服务端配置 CORS 允许 Netlify 站点域名

---

## 六、本地预览生产构建

```bash
npm run build
npm run preview
```

在浏览器中访问 `http://localhost:4173` 查看构建结果（豆包代理需同时运行 `npm run server`）。
