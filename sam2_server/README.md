# 街景立面分割服务（SegFormer + ADE20K）

使用 HuggingFace SegFormer B5，直接 `pip install transformers` 即可，无需外部仓库。

## 关键类别

| 类别 | ADE20K ID (0-based) | 说明 |
|------|---------------------|------|
| windowpane;window | 8 | 立面玻璃窗（透明度指标） |
| signboard;sign | 43 | 招牌 |

> 注：原 glass ID=113 是"饮用玻璃杯"，不适合立面分析，已改为 windowpane(8)。

## 安装与运行

```bash
cd sam2_server
pip install -r requirements.txt
python -m uvicorn app:app --port 3002 --reload
```

首次推理时会自动下载模型（约 370MB）。国内网络会自动使用 hf-mirror.com 镜像。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SEGFORMER_MODEL` | `nvidia/segformer-b5-finetuned-ade-640-640` | 模型名 |
| `SEGFORMER_DEVICE` | 自动 | `cpu` 强制 CPU |
| `SEGFORMER_FP16` | `1` | GPU 上使用半精度，节省显存 |
| `SEGFORMER_MAX_SIZE` | `1024` | 输入长边上限，防 OOM |

## API

- `POST /segment`：传入 `{"image_base64": "..."}`，返回分割图与指标
- `POST /color-richness`：仅色彩丰富度，不依赖 GPU
- `GET /health`：健康检查
