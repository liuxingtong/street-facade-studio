"""
街景立面分割服务 - SAM2 + 色彩丰富度

- /segment-masks: SAM2 自动切割，返回可点击的 mask 列表（按面积过滤、数量限制）
- /segment-at-point: 点击任意位置，SAM2 点提示分割该区域（全图可标注）
- /color-richness: 色彩丰富度
"""
from __future__ import annotations

import os

# 国内网络需在导入 transformers 前设置镜像，否则无法下载模型
if "HF_ENDPOINT" not in os.environ:
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

import base64
import io
from typing import List, Tuple

import cv2
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

# SAM2 配置
SAM2_MODEL = os.environ.get("SAM2_MODEL", "facebook/sam2.1-hiera-base-plus")
SAM2_MAX_MASKS = int(os.environ.get("SAM2_MAX_MASKS", "80"))  # 最多返回 mask 数量
SAM2_MIN_AREA_RATIO = float(os.environ.get("SAM2_MIN_AREA_RATIO", "0.002"))  # 最小面积占比（0.2%）
SAM2_MAX_SIZE = int(os.environ.get("SAM2_MAX_SIZE", "512"))  # 输入长边上限，降低 GPU 消耗

_sam2_generator = None
_sam2_processor = None
_sam2_point_model = None


def _resize_for_sam2(img: Image.Image) -> Tuple[Image.Image, float, int, int]:
    """限制长边为 SAM2_MAX_SIZE，返回 (resized_img, scale, orig_w, orig_h)"""
    w, h = img.size
    orig_w, orig_h = w, h
    if max(w, h) <= SAM2_MAX_SIZE:
        return img, 1.0, orig_w, orig_h
    scale = SAM2_MAX_SIZE / max(w, h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS), scale, orig_w, orig_h


def get_sam2_generator():
    """SAM2 mask-generation pipeline，首次调用时加载"""
    global _sam2_generator
    if _sam2_generator is None:
        device = 0 if torch.cuda.is_available() else -1
        print(f"[SAM2] 加载模型: {SAM2_MODEL}  device={device}")
        _sam2_generator = __import__("transformers").pipeline(
            "mask-generation",
            model=SAM2_MODEL,
            device=device,
        )
        print("[SAM2] 模型已就绪。")
    return _sam2_generator


def get_sam2_point_model():
    """SAM2 点提示模型，用于点击任意位置分割"""
    global _sam2_processor, _sam2_point_model
    if _sam2_point_model is None:
        from transformers import Sam2Processor, Sam2Model
        device = 0 if torch.cuda.is_available() else -1
        if device >= 0:
            device = f"cuda:{device}"
        else:
            device = "cpu"
        print(f"[SAM2] 加载点提示模型: {SAM2_MODEL}  device={device}")
        _sam2_processor = Sam2Processor.from_pretrained(SAM2_MODEL)
        _sam2_point_model = Sam2Model.from_pretrained(SAM2_MODEL).to(device)
        print("[SAM2] 点提示模型已就绪。")
    return _sam2_processor, _sam2_point_model


def compute_color_richness_and_histogram(img: np.ndarray) -> Tuple[int, float, List[float], dict]:
    """用 OpenCV 统计整图色彩丰富度"""
    img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    h_hist_raw = cv2.calcHist([hsv], [0], None, [180], [0, 180])
    h_hist_raw = h_hist_raw.flatten() / (h_hist_raw.sum() + 1e-8)
    h_hist_18 = [float(h_hist_raw[i * 10 : (i + 1) * 10].sum()) for i in range(18)]

    h_hist = h_hist_raw[h_hist_raw > 0]
    entropy = float(-np.sum(h_hist * np.log2(h_hist + 1e-10)))
    s_mean = float(np.mean(s))
    nonzero_bins = int(np.sum(h_hist_raw > 0.001))
    hue_diversity = nonzero_bins / 180.0
    raw = (entropy / 4.0 * 40) + (min(s_mean / 128.0, 1.0) * 30) + (hue_diversity * 30)
    cr = min(100, max(0, int(100 * (raw / 100) ** 1.8)))
    raw_vars = {
        "HueEntropy": round(entropy, 6),
        "SaturationMean": round(s_mean, 4),
        "HueDiversity": round(hue_diversity, 6),
        "NonzeroBins": nonzero_bins,
    }
    return cr, float(raw), h_hist_18, raw_vars


# ─── FastAPI ─────────────────────────────────────────────────────────────────

app = FastAPI(title="Facade Segmentation Service (SAM2)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ColorRichnessRequest(BaseModel):
    image_base64: str


class ColorRichnessResponse(BaseModel):
    ColorRichness: int
    ColorRichnessRaw: float
    ColorRawVars: dict
    HueHistogram: List[float]


@app.post("/color-richness", response_model=ColorRichnessResponse)
def color_richness(request: ColorRichnessRequest):
    raw = request.image_base64.strip()
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无效的 base64: {e}")
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img_np = np.array(img)
    cr, raw_val, hist, raw_vars = compute_color_richness_and_histogram(img_np)
    return ColorRichnessResponse(
        ColorRichness=cr,
        ColorRichnessRaw=round(raw_val, 4),
        ColorRawVars=raw_vars,
        HueHistogram=hist,
    )


# ─── SAM2 segment-masks ─────────────────────────────────────────────────────

class SegmentMasksRequest(BaseModel):
    image_base64: str


class MaskItem(BaseModel):
    id: int
    polygon: List[List[int]]  # [[x,y], ...]
    area: int
    bbox: List[int]  # [x, y, w, h]


class SegmentMasksResponse(BaseModel):
    masks: List[MaskItem]
    width: int
    height: int


def _mask_to_polygon(mask_np: np.ndarray) -> Tuple[List[List[int]], int, List[int]]:
    """从二值 mask 提取 polygon、面积、bbox"""
    mask_uint8 = (mask_np * 255).astype(np.uint8) if mask_np.dtype != np.uint8 else mask_np
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return [], 0, [0, 0, 0, 0]
    areas = [cv2.contourArea(c) for c in contours]
    idx = int(np.argmax(areas))
    cnt = contours[idx]
    area = int(areas[idx])
    x, y, w, h = cv2.boundingRect(cnt)
    peri = cv2.arcLength(cnt, True)
    epsilon = max(2, 0.002 * peri)
    approx = cv2.approxPolyDP(cnt, epsilon, True)
    polygon = [[int(p[0][0]), int(p[0][1])] for p in approx]
    return polygon, area, [int(x), int(y), int(w), int(h)]


@app.post("/segment-masks", response_model=SegmentMasksResponse)
def segment_masks(request: SegmentMasksRequest):
    raw = request.image_base64.strip()
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无效的 base64: {e}")
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img_small, scale, orig_w, orig_h = _resize_for_sam2(img)
    h_s, w_s = img_small.height, img_small.width
    total_area = h_s * w_s
    min_area = int(total_area * SAM2_MIN_AREA_RATIO)

    try:
        generator = get_sam2_generator()
        outputs = generator(img_small, points_per_batch=64, pred_iou_thresh=0.82)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SAM2 分割失败: {e}")

    masks_tensor = outputs.get("masks")
    scores_tensor = outputs.get("scores", None)
    if masks_tensor is None or len(masks_tensor) == 0:
        return SegmentMasksResponse(masks=[], width=orig_w, height=orig_h)

    inv_scale = 1.0 / scale
    mask_list = []
    scores = scores_tensor.cpu().numpy().tolist() if scores_tensor is not None else [1.0] * len(masks_tensor)
    for i, m in enumerate(masks_tensor):
        mask_np = m.cpu().numpy() if hasattr(m, "cpu") else np.array(m)
        if mask_np.dtype == bool:
            mask_np = mask_np.astype(np.uint8) * 255
        polygon, area, bbox = _mask_to_polygon(mask_np)
        if area < min_area or len(polygon) < 3:
            continue
        polygon_orig = [[int(x * inv_scale), int(y * inv_scale)] for x, y in polygon]
        area_orig = int(area * inv_scale * inv_scale)
        bbox_orig = [int(bbox[0] * inv_scale), int(bbox[1] * inv_scale), int(bbox[2] * inv_scale), int(bbox[3] * inv_scale)]
        score = scores[i] if i < len(scores) else 1.0
        mask_list.append({"polygon": polygon_orig, "area": area_orig, "bbox": bbox_orig, "score": float(score)})

    mask_list.sort(key=lambda x: x["area"], reverse=True)
    mask_list = mask_list[:SAM2_MAX_MASKS]

    result = [
        MaskItem(id=i, polygon=m["polygon"], area=m["area"], bbox=m["bbox"])
        for i, m in enumerate(mask_list)
    ]
    return SegmentMasksResponse(masks=result, width=orig_w, height=orig_h)


# ─── SAM2 segment-at-point（全图可标注）────────────────────────────────────────

class SegmentAtPointRequest(BaseModel):
    image_base64: str
    x: int  # 原图坐标
    y: int


class SegmentAtPointResponse(BaseModel):
    mask: MaskItem | None  # 成功时返回，失败时 None
    width: int
    height: int


@app.post("/segment-at-point", response_model=SegmentAtPointResponse)
def segment_at_point(request: SegmentAtPointRequest):
    """点击任意位置，SAM2 点提示分割该区域，实现全图可标注"""
    raw = request.image_base64.strip()
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无效的 base64: {e}")
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    orig_w, orig_h = img.size
    img_small, scale, orig_w, orig_h = _resize_for_sam2(img)
    x_small = int(request.x * scale)
    y_small = int(request.y * scale)
    x_small = max(0, min(img_small.width - 1, x_small))
    y_small = max(0, min(img_small.height - 1, y_small))

    try:
        processor, model = get_sam2_point_model()
        input_points = [[[[x_small, y_small]]]]
        input_labels = [[[1]]]
        print(f"[SAM2 point] img={img_small.size} point=({x_small},{y_small}) device={model.device}")
        inputs_cpu = processor(
            images=img_small,
            input_points=input_points,
            input_labels=input_labels,
            return_tensors="pt",
        )
        original_sizes = inputs_cpu["original_sizes"].clone()
        inputs_dev = inputs_cpu.to(model.device)
        with torch.no_grad():
            outputs = model(**inputs_dev, multimask_output=False)
        print(f"[SAM2 point] pred_masks shape: {outputs.pred_masks.shape}")
        masks = processor.post_process_masks(
            outputs.pred_masks.cpu(), original_sizes
        )[0]
        print(f"[SAM2 point] post_process masks shape: {masks.shape}")
    except Exception as e:
        import traceback
        print(f"[SAM2 point] ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"SAM2 点提示分割失败: {e}")

    if masks is None or masks.numel() == 0:
        print("[SAM2 point] no masks returned")
        return SegmentAtPointResponse(mask=None, width=orig_w, height=orig_h)

    # masks shape: [num_objects, num_masks, H, W] after post_process_masks
    # with multimask_output=False: [1, 1, H, W]
    mask_np = masks[0, 0].numpy()
    if mask_np.dtype == bool:
        mask_np = mask_np.astype(np.uint8) * 255
    polygon, area, bbox = _mask_to_polygon(mask_np)
    if area < 10 or len(polygon) < 3:
        return SegmentAtPointResponse(mask=None, width=orig_w, height=orig_h)

    inv_scale = 1.0 / scale
    polygon_orig = [[int(x * inv_scale), int(y * inv_scale)] for x, y in polygon]
    area_orig = int(area * inv_scale * inv_scale)
    bbox_orig = [
        int(bbox[0] * inv_scale),
        int(bbox[1] * inv_scale),
        int(bbox[2] * inv_scale),
        int(bbox[3] * inv_scale),
    ]
    mask_item = MaskItem(id=0, polygon=polygon_orig, area=area_orig, bbox=bbox_orig)
    return SegmentAtPointResponse(mask=mask_item, width=orig_w, height=orig_h)


@app.get("/")
def root():
    return {"service": "Facade Segmentation (SAM2)", "docs": "/docs", "health": "/health"}


@app.get("/favicon.ico")
def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "sam2_loaded": _sam2_generator is not None,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
    }


@app.on_event("startup")
def on_startup():
    """启动时预加载 SAM2 模型"""
    print("\n[SAM2] 预加载模型（首次会从镜像下载约 1GB）...")
    try:
        get_sam2_generator()
    except Exception as e:
        print(f"[SAM2] 预加载失败（首次推理时会重试）: {e}\n")
