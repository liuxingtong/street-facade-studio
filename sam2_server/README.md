# 街景立面分割服务（SAM2）

- **SAM2**：`/segment-masks` 自动切割，返回可点击标注的 mask 列表
- **色彩丰富度**：`/color-richness`

## 安装与运行

```bash
cd sam2_server
pip install -r requirements.txt
python -m uvicorn app:app --port 3002 --reload
```

启动时自动下载并加载 SAM2（约 1GB）。国内网络使用 hf-mirror.com 镜像。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SAM2_MODEL` | `facebook/sam2.1-hiera-base-plus` | SAM2 模型 |
| `SAM2_MAX_MASKS` | `50` | 最多返回 mask 数量 |
| `SAM2_MIN_AREA_RATIO` | `0.005` | 最小面积占比（0.5%） |

## API

- `POST /segment-masks`：SAM2 切割，返回 `{ masks, width, height }`，前端手动标注后计算指标
- `POST /color-richness`：色彩丰富度
- `GET /health`：健康检查
