"""
SAM2 图像分割服务 - 基于 Hugging Face Transformers mask-generation pipeline
用于街景立面实例分割与指标计算，豆包仅用于图像生成
"""
from __future__ import annotations

import base64
import io
import os
from typing import List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

# 延迟加载模型以加快启动
_generator = None

SAM2_MODEL = os.environ.get("SAM2_MODEL", "facebook/sam2-hiera-base-plus")


def get_generator():
    global _generator
    if _generator is None:
        from transformers import pipeline

        device = 0 if __import__("torch").cuda.is_available() else -1
        _generator = pipeline(
            "mask-generation",
            model=SAM2_MODEL,
            device=device,
        )
    return _generator


def rgb_to_hsv(r, g, b):
    r, g, b = r / 255.0, g / 255.0, b / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    df = mx - mn
    if mx == mn:
        h = 0
    elif mx == r:
        h = (60 * ((g - b) / df) + 360) % 360
    elif mx == g:
        h = 60 * ((b - r) / df) + 120
    else:
        h = 60 * ((r - g) / df) + 240
    s = 0 if mx == 0 else df / mx
    v = mx
    return h, s, v


def classify_mask_region(img: np.ndarray, mask: np.ndarray) -> str:
    """根据掩码区域内原图颜色，将区域分类为 glass/signage；color 已改用 OpenCV 统计，不再标注"""
    if mask.dtype != bool:
        mask = mask.astype(bool)
    pixels = img[mask]
    if len(pixels) == 0:
        return "other"
    mean_rgb = pixels.mean(axis=0)
    r, g, b = mean_rgb[0], mean_rgb[1], mean_rgb[2]
    _, s, v = rgb_to_hsv(r, g, b)
    # 低饱和度 + 高亮度 -> 玻璃/透明
    if s < 0.15 and v > 0.4:
        return "glass"
    # 高饱和度 -> 招牌
    if s > 0.25:
        area = mask.sum()
        if 500 < area < 50000:
            return "signage"
        return "signage"  # 大面积/小面积高饱和也归为招牌
    if s > 0.15:
        return "signage"
    return "glass"


def compute_color_richness_and_histogram(img: np.ndarray) -> Tuple[int, float, List[float], dict]:
    """
    用 OpenCV 统计整图色彩丰富度，并返回色相直方图（18 档，每档 20°）。
    返回 (ColorRichness 0-100, ColorRichnessRaw, hue_histogram, raw_vars)
    raw_vars: 计算色彩丰富度的三个原始变量
    """
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


def build_overlay_and_metrics(
    img: np.ndarray,
    masks: list,
    scores: Optional[list] = None,
    pred_iou_thresh: float = 0.85,
) -> Tuple[Image.Image, dict]:
    """
    根据 SAM2 掩码生成彩色分割图并计算立面指标
    返回 (PIL overlay image, metrics dict)
    """
    h, w = img.shape[:2]
    overlay = np.zeros((h, w, 4), dtype=np.uint8)
    overlay[:, :, :3] = (img.astype(np.float32) * 0.5).astype(np.uint8)  # 原图变暗作底
    overlay[:, :, 3] = 255

    color_map = {"glass": [0.12, 0.56, 1.0, 0.6], "signage": [1.0, 0.2, 0.2, 0.6]}

    total_area = h * w
    glass_area = 0
    signage_area = 0
    mask_count = 0

    for i, mask in enumerate(masks):
        if scores is not None and i < len(scores):
            sc = scores[i]
            if hasattr(sc, "item"):
                sc = sc.item()
            if float(sc) < pred_iou_thresh:
                continue
        mask_np = np.array(mask.cpu()) if hasattr(mask, "cpu") else (np.array(mask) if not isinstance(mask, np.ndarray) else mask)
        if mask_np.shape[:2] != (h, w):
            mask_pil = Image.fromarray(mask_np.astype(np.uint8))
            mask_pil = mask_pil.resize((w, h), Image.NEAREST)
            mask_np = np.array(mask_pil).astype(bool)
        else:
            mask_np = mask_np.astype(bool)

        label = classify_mask_region(img, mask_np)
        c = color_map.get(label)  # "other" 不绘制，保持原图暗底
        if c is not None:
            overlay[:, :, 0] = np.where(mask_np, np.uint8(c[0] * 255), overlay[:, :, 0])
            overlay[:, :, 1] = np.where(mask_np, np.uint8(c[1] * 255), overlay[:, :, 1])
            overlay[:, :, 2] = np.where(mask_np, np.uint8(c[2] * 255), overlay[:, :, 2])
            overlay[:, :, 3] = np.where(mask_np, np.uint8(c[3] * 255), overlay[:, :, 3])

        area = mask_np.sum()
        mask_count += 1
        if label == "glass":
            glass_area += area
        elif label == "signage":
            signage_area += area

    # 计算指标 0-100
    transparency = min(100, int(100 * glass_area / max(1, total_area)))
    signage_ratio = signage_area / max(1, total_area)
    signage_scale = min(100, int(100 * signage_ratio * 3))  # 放大以更好区分
    color_richness, color_richness_raw, hue_histogram, color_raw_vars = compute_color_richness_and_histogram(img)

    # 若几乎没有分类到 glass，用低饱和度区域近似
    if glass_area < total_area * 0.05 and mask_count > 0:
        gray_mask = np.zeros((h, w), dtype=bool)
        for y in range(0, h, 4):
            for x in range(0, w, 4):
                r, g, b = img[y, x, 0], img[y, x, 1], img[y, x, 2]
                _, s, v = rgb_to_hsv(r, g, b)
                if s < 0.2 and v > 0.3:
                    gray_mask[y : y + 4, x : x + 4] = True
        glass_area = min(glass_area + gray_mask.sum() * 0.3, total_area * 0.6)
        transparency = min(100, int(100 * glass_area / max(1, total_area)))

    metrics = {
        "Transparency": transparency,
        "SignageScale": signage_scale,
        "ColorRichness": color_richness,
        "ColorRichnessRaw": round(color_richness_raw, 4),
        "ColorRawVars": color_raw_vars,
        "HueHistogram": hue_histogram,
        "StyleDescription": "Facade analysis via SAM2 instance segmentation",
        "Reasoning": f"Detected {mask_count} instance regions. Glass/transparent {transparency}%, signage {signage_scale}%. Color richness from OpenCV hue entropy and saturation.",
    }

    overlay_pil = Image.fromarray(overlay).convert("RGB")
    return overlay_pil, metrics


app = FastAPI(title="SAM2 Facade Analysis")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SegmentRequest(BaseModel):
    image_base64: str  # data:image/xxx;base64,... 或纯 base64


class SegmentResponse(BaseModel):
    segmentation_image_base64: str
    Transparency: int
    SignageScale: int
    ColorRichness: int
    ColorRichnessRaw: float
    ColorRawVars: dict  # HueEntropy, SaturationMean, HueDiversity, NonzeroBins
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
    """仅用 OpenCV 统计整图色彩丰富度，不依赖 SAM2 分割"""
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

    gen = get_generator()
    outputs = gen(img, points_per_batch=64, pred_iou_thresh=0.85)

    masks = outputs.get("masks", [])
    scores = outputs.get("scores")
    if not masks:
        raise HTTPException(status_code=500, detail="SAM2 未生成任何掩码")

    overlay_pil, metrics = build_overlay_and_metrics(img_np, masks, scores, pred_iou_thresh=0.85)

    buf = io.BytesIO()
    overlay_pil.save(buf, format="PNG")
    seg_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return SegmentResponse(
        segmentation_image_base64=f"data:image/png;base64,{seg_b64}",
        **metrics,
    )


@app.get("/health")
def health():
    return {"status": "ok", "model": SAM2_MODEL}
