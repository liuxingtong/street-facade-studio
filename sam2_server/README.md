# SAM2 街景分割服务

基于 Hugging Face Transformers 的 `mask-generation` pipeline，使用 SAM2 进行实例分割，无需安装官方 SAM2 仓库。

## 依赖

- Python 3.10+
- PyTorch（建议 2.0+，支持 CUDA 更佳）

## 安装与运行

```bash
cd sam2_server
pip install -r requirements.txt
python -m uvicorn app:app --port 3002 --reload
```

或从项目根目录：

```bash
npm run sam2
```

## 环境变量

- `SAM2_MODEL`：模型 ID，默认 `facebook/sam2-hiera-base-plus`
  - 可选：`facebook/sam2-hiera-small`（更快，精度略低）

## API

- `POST /segment`：传入 `{"image_base64": "data:image/...;base64,..."}`，返回分割图与指标
- `GET /health`：健康检查
