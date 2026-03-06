# Railway 部署指南

将 Street Facade Studio 部署到 [Railway](https://railway.app) 需要创建 **两个服务**：主应用（前端 + 豆包代理）和 SAM2 分析服务。

---

## 一、前置准备

1. 注册 [Railway](https://railway.app)
2. 安装 [Railway CLI](https://docs.railway.app/develop/cli)（可选，用于本地调试）
3. 确保代码已推送到 GitHub

---

## 二、部署主应用（前端 + 豆包代理）

### 1. 创建新项目

1. 登录 [Railway Dashboard](https://railway.app/dashboard)
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择 `liuxingtong/street-facade-studio`
4. Railway 会检测到项目并创建服务

### 2. 配置主服务

在服务设置中确认：

| 配置项 | 值 |
|--------|-----|
| Root Directory | 留空（使用仓库根目录） |
| Build Command | `npm run build` |
| Start Command | `npm run start` |
| Watch Paths | 留空或 `!sam2_server/**`（避免 SAM2 改动触发主服务重建） |

### 3. 设置环境变量

在 **Variables** 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DOUBAO_API_KEY` | 你的火山方舟 API Key | 必填 |
| `DOUBAO_IMAGE_ENDPOINT` | 图像生成接入点 ID | 必填 |
| `SAM2_SERVICE_URL` | 见下方 | 部署 SAM2 后再填 |

### 4. 生成域名

在 **Settings** → **Networking** → **Generate Domain**，得到主应用地址，例如：

`https://street-facade-studio-production.up.railway.app`

---

## 三、部署 SAM2 服务

### 1. 添加新服务

1. 在主项目内点击 **+ New** → **GitHub Repo**
2. 再次选择 `liuxingtong/street-facade-studio`
3. 新建一个服务

### 2. 配置 SAM2 服务

在服务设置中：

| 配置项 | 值 |
|--------|-----|
| **Root Directory** | `sam2_server` |
| Build Command | 留空（使用 railway.json） |
| Start Command | 留空（使用 railway.json） |

### 3. 生成 SAM2 域名

在 SAM2 服务的 **Settings** → **Networking** → **Generate Domain**，得到类似：

`https://street-facade-studio-sam2-production.up.railway.app`

### 4. 配置主服务的 SAM2 地址

回到**主应用**的 **Variables**，设置：

```
SAM2_SERVICE_URL=https://street-facade-studio-sam2-production.up.railway.app
```

（替换为你的 SAM2 实际域名，末尾不要加 `/`）

### 5. 重新部署主应用

修改环境变量后，在主应用中选择 **Redeploy**，使新配置生效。

---

## 四、注意事项

### SAM2 资源

- SAM2 依赖 PyTorch，首次构建可能较慢（约 5–10 分钟）
- Railway 免费额度有限，SAM2 可能因内存不足启动失败
- 若失败，可考虑：
  - 升级 Railway 付费计划
  - 使用 [Modal](https://modal.com)、[Replicate](https://replicate.com) 等 GPU 平台托管 SAM2

### 仅部署主应用（无 SAM2）

若暂时不部署 SAM2：

- 不配置 `SAM2_SERVICE_URL`
- 主应用可正常访问，豆包图像生成可用
- 分析功能会提示「SAM2 服务不可用」

---

## 五、本地验证生产构建

```bash
# 构建前端
npm run build

# 设置环境变量后启动
$env:SAM2_SERVICE_URL="http://localhost:3002"  # PowerShell
$env:DOUBAO_API_KEY="your-key"
$env:DOUBAO_IMAGE_ENDPOINT="your-endpoint"
npm run start
```

访问 `http://localhost:3000`，并确保本地 SAM2 在 3002 端口运行。
