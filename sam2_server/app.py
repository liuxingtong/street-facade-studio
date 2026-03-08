"""
街景立面分割服务 - SegFormer + ADE20K
使用 HuggingFace SegFormer，pip install transformers 即可，无需外部仓库。

关键修正：
  - glass 类别改为 windowpane;window (ID=8)，原 ID=113 是饮用玻璃杯，不适合立面分析
  - signboard;sign (ID=43) 不变
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
import torch.nn.functional as F
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

# 目标类别名称（与模型 id2label 匹配，忽略大小写、支持部分匹配）
TARGET_CLASSES = {
    "window": "Transparency",   # windowpane;window → 透明度
    "signboard": "SignageScale", # signboard;sign → 招牌
}

# 运行时从模型 config 解析出的 {class_name: id}，启动后填充
_label2id: dict[str, int] = {}
_id2label: dict[int, str] = {}

# 配置
SEGFORMER_MODEL = os.environ.get("SEGFORMER_MODEL", "nvidia/segformer-b5-finetuned-ade-640-640")
SEGFORMER_DEVICE = os.environ.get("SEGFORMER_DEVICE", "").lower()  # "cpu" 强制 CPU
USE_FP16 = os.environ.get("SEGFORMER_FP16", "1").lower() in ("1", "true", "yes")
SEG_MAX_SIZE = int(os.environ.get("SEGFORMER_MAX_SIZE", "1024"))  # 输入长边上限（防 OOM）

# 延迟加载
_processor = None
_model = None


def _get_device() -> torch.device:
    if SEGFORMER_DEVICE == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _resolve_target_ids():
    """从模型 config 的 id2label 解析目标类别 ID，支持部分名称匹配。"""
    global _label2id, _id2label
    if not _model:
        return
    raw = getattr(_model.config, "id2label", {})
    _id2label = {int(k): v.lower() for k, v in raw.items()}
    _label2id = {v: int(k) for k, v in _id2label.items()}

    print("\n[SegFormer] 目标类别 ID 解析结果：")
    for keyword, metric in TARGET_CLASSES.items():
        matched = [(label, idx) for label, idx in _label2id.items() if keyword in label]
        if matched:
            for label, idx in matched:
                print(f"  {metric:14s} ← [{idx:3d}] {label}")
        else:
            print(f"  {metric:14s} ← 未找到包含 '{keyword}' 的类别")
    print()


def _get_target_id(keyword: str) -> int:
    """按关键词查找类别 ID（首个匹配）。找不到时 fallback 到 ADE20K 已知 ID。"""
    fallbacks = {"window": 8, "signboard": 43}
    for label, idx in _label2id.items():
        if keyword in label:
            return idx
    return fallbacks.get(keyword, -1)


def get_model():
    global _processor, _model
    if _processor is None:
        from transformers import SegformerImageProcessor, SegformerForSemanticSegmentation

        device = _get_device()
        print(f"[SegFormer] 加载模型: {SEGFORMER_MODEL}  device={device}")
        _processor = SegformerImageProcessor.from_pretrained(SEGFORMER_MODEL)
        _model = SegformerForSemanticSegmentation.from_pretrained(SEGFORMER_MODEL)
        _model.eval()
        if USE_FP16 and device.type == "cuda":
            _model = _model.half()
        _model = _model.to(device)
        _resolve_target_ids()
        print("[SegFormer] 模型已就绪。")
    return _processor, _model


def _resize_if_needed(img: np.ndarray) -> np.ndarray:
    """限制长边，避免 OOM"""
    h, w = img.shape[:2]
    if max(h, w) <= SEG_MAX_SIZE:
        return img
    scale = SEG_MAX_SIZE / max(h, w)
    return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LINEAR)


def run_segformer(img_np: np.ndarray) -> np.ndarray:
    """
    运行 SegFormer 推理，返回语义分割图 (H×W)，值为 ADE20K 0-based 类别 ID (0-149)。
    """
    processor, model = get_model()
    device = next(model.parameters()).device
    dtype = next(model.parameters()).dtype

    img_pil = Image.fromarray(img_np)
    ori_h, ori_w = img_np.shape[:2]

    inputs = processor(images=img_pil, return_tensors="pt")
    pixel_values = inputs["pixel_values"].to(device=device, dtype=dtype)

    with torch.no_grad():
        outputs = model(pixel_values=pixel_values)
        logits = outputs.logits  # (1, num_classes, H/4, W/4)
        upsampled = F.interpolate(
            logits.float(),
            size=(ori_h, ori_w),
            mode="bilinear",
            align_corners=False,
        )
        seg = upsampled.argmax(dim=1).squeeze(0).cpu().numpy().astype(np.int32)

    return seg


def compute_glass_signboard_area(seg: np.ndarray) -> dict:
    """面积统计（ID 从模型 config 动态解析）"""
    total = seg.size
    window_id = _get_target_id("window")
    signboard_id = _get_target_id("signboard")
    window_pixels = int((seg == window_id).sum()) if window_id >= 0 else 0
    signboard_pixels = int((seg == signboard_id).sum()) if signboard_id >= 0 else 0
    return {
        "window_pixels": window_pixels,
        "signboard_pixels": signboard_pixels,
        "window_ratio": window_pixels / max(1, total),
        "signboard_ratio": signboard_pixels / max(1, total),
    }


def _print_seg_stats(seg: np.ndarray):
    """在控制台打印前 10 个最大面积类别的名称和占比。"""
    total = seg.size
    unique, counts = np.unique(seg, return_counts=True)
    order = np.argsort(counts)[::-1]
    print("\n[SegFormer] 本次识别结果（面积前10）：")
    print(f"  {'ID':>4}  {'类别名':<35} {'像素数':>8}  {'占比':>6}")
    print(f"  {'-'*4}  {'-'*35} {'-'*8}  {'-'*6}")
    for i in order[:10]:
        cid = int(unique[i])
        cnt = int(counts[i])
        label = _id2label.get(cid, f"id={cid}")
        pct = cnt / total * 100
        marker = ""
        for kw in TARGET_CLASSES:
            if kw in label:
                marker = " ◀"
        print(f"  {cid:>4}  {label:<35} {cnt:>8}  {pct:>5.1f}%{marker}")
    print()


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


def build_overlay_and_metrics(img: np.ndarray, seg: np.ndarray) -> Tuple[Image.Image, dict]:
    """
    从 SegFormer 分割结果生成彩色叠加图与立面指标。
    windowpane → 蓝色，signboard → 红色
    """
    _print_seg_stats(seg)

    window_id = _get_target_id("window")
    signboard_id = _get_target_id("signboard")
    window_label = _id2label.get(window_id, "windowpane")
    signboard_label = _id2label.get(signboard_id, "signboard")

    h, w = img.shape[:2]
    overlay = np.zeros((h, w, 4), dtype=np.uint8)
    overlay[:, :, :3] = (img.astype(np.float32) * 0.5).astype(np.uint8)
    overlay[:, :, 3] = 255

    window_mask = seg == window_id
    signboard_mask = seg == signboard_id

    # 蓝色 = 玻璃窗
    overlay[window_mask, 0] = np.uint8(0.12 * 255)
    overlay[window_mask, 1] = np.uint8(0.56 * 255)
    overlay[window_mask, 2] = np.uint8(1.0 * 255)
    overlay[window_mask, 3] = np.uint8(0.75 * 255)

    # 红色 = 招牌
    overlay[signboard_mask, 0] = np.uint8(1.0 * 255)
    overlay[signboard_mask, 1] = np.uint8(0.2 * 255)
    overlay[signboard_mask, 2] = np.uint8(0.2 * 255)
    overlay[signboard_mask, 3] = np.uint8(0.75 * 255)

    area_stats = compute_glass_signboard_area(seg)
    total_area = h * w
    window_pixels = area_stats["window_pixels"]
    signboard_pixels = area_stats["signboard_pixels"]

    transparency = min(100, int(100 * window_pixels / max(1, total_area)))
    signage_ratio = signboard_pixels / max(1, total_area)
    signage_scale = min(100, int(100 * signage_ratio * 3))

    color_richness, color_richness_raw, hue_histogram, color_raw_vars = compute_color_richness_and_histogram(img)

    metrics = {
        "Transparency": transparency,
        "SignageScale": signage_scale,
        "ColorRichness": color_richness,
        "ColorRichnessRaw": round(color_richness_raw, 4),
        "ColorRawVars": color_raw_vars,
        "HueHistogram": hue_histogram,
        "StyleDescription": "Facade analysis via SegFormer ADE20K semantic segmentation",
        "Reasoning": (
            f"Window/glass {transparency}%, signage {signage_scale}%. "
            f"SegFormer B5 ADE20K: '{window_label}'(id={window_id}), '{signboard_label}'(id={signboard_id}). "
            f"Color richness from OpenCV hue entropy."
        ),
    }

    overlay_pil = Image.fromarray(overlay).convert("RGB")
    return overlay_pil, metrics


# ─── FastAPI ─────────────────────────────────────────────────────────────────

app = FastAPI(title="Facade Segmentation Service (SegFormer)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SegmentRequest(BaseModel):
    image_base64: str


class SegmentResponse(BaseModel):
    segmentation_image_base64: str
    Transparency: int
    SignageScale: int
    ColorRichness: int
    ColorRichnessRaw: float
    ColorRawVars: dict
    HueHistogram: List[float]
    StyleDescription: str
    Reasoning: str


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


@app.post("/segment", response_model=SegmentResponse)
def segment(request: SegmentRequest):
    raw = request.image_base64.strip()
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无效的 base64: {e}")

    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img_np = np.array(img)
    img_np = _resize_if_needed(img_np)

    try:
        seg = run_segformer(img_np)
        overlay_pil, metrics = build_overlay_and_metrics(img_np, seg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分割失败: {e}")

    buf = io.BytesIO()
    overlay_pil.save(buf, format="PNG")
    seg_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return SegmentResponse(
        segmentation_image_base64=f"data:image/png;base64,{seg_b64}",
        **metrics,
    )


@app.get("/health")
def health():
    loaded = _processor is not None
    return {
        "status": "ok",
        "model": SEGFORMER_MODEL,
        "model_loaded": loaded,
        "device": str(_get_device()),
        "fp16": USE_FP16,
    }


@app.on_event("startup")
def preload_model():
    """启动时预加载模型，便于在终端看到下载进度"""
    print("\n[SegFormer] 预加载模型（首次会从镜像下载约 370MB）...")
    try:
        get_model()
    except Exception as e:
        print(f"[SegFormer] 预加载失败（首次推理时会重试）: {e}\n")
