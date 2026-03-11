"""
make_eeg_stimulus_video.py — 街景脑电实验刺激视频合成
══════════════════════════════════════════════════════════════════════════════

将 begin 图、三个文件夹的 27 张图片及黑屏按指定时长合成为 MP4，
图片顺序随机以降低顺序效应。

时间轴
──────
  begin.png    10s
  黑屏         30s
  文件夹1      27×5s（随机顺序）
  黑屏         30s
  文件夹2      27×5s（随机顺序）
  黑屏         30s
  文件夹3      27×5s（随机顺序）
  黑屏         30s

运行
──────
  python make_eeg_stimulus_video.py

输出
──────
  F:\\Aworks\\HFE2\\result\\eeg_stimulus.mp4

依赖
──────
  opencv-python (cv2), numpy
"""

import os
import random
import cv2
import numpy as np

# ─── 配置 ────────────────────────────────────────────────────────────────────
ROOT       = r"F:\Aworks\HFE2\result"
BEGIN_PATH = os.path.join(ROOT, "begin.png")
FOLDERS    = [
    os.path.join(ROOT, "1", "matrix_export", "images"),
    os.path.join(ROOT, "2", "matrix_export", "images"),
    os.path.join(ROOT, "3", "matrix_export", "images"),
]
OUTPUT_PATH = os.path.join(ROOT, "eeg_stimulus.mp4")

FPS         = 30
WIDTH       = 1920
HEIGHT      = 1080

DUR_BEGIN   = 10   # s
DUR_BLACK   = 30   # s
DUR_IMAGE   = 5    # s per image
IMAGES_PER  = 27   # per folder

# ─── 工具 ────────────────────────────────────────────────────────────────────
def load_and_fit(path, w, h):
    """加载图片并等比缩放至 (w,h)，不足处黑边填充"""
    img = cv2.imread(path)
    if img is None:
        return None
    ih, iw = img.shape[:2]
    scale = min(w / iw, h / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    img = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    out = np.zeros((h, w, 3), dtype=np.uint8)
    out[:] = 0
    y0 = (h - nh) // 2
    x0 = (w - nw) // 2
    out[y0:y0+nh, x0:x0+nw] = img
    return out


def write_frames(writer, frame, duration_sec, fps):
    n = int(duration_sec * fps)
    for _ in range(n):
        writer.write(frame)


def main():
    random.seed(42)  # 可复现的随机顺序

    # 1. 加载 begin 图
    print("加载 begin.png ...")
    begin = load_and_fit(BEGIN_PATH, WIDTH, HEIGHT)
    if begin is None:
        print(f"[ERR] 无法加载 {BEGIN_PATH}")
        return
    black = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)

    # 2. 初始化视频写入
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(OUTPUT_PATH, fourcc, FPS, (WIDTH, HEIGHT))
    if not writer.isOpened():
        print(f"[ERR] 无法创建视频 {OUTPUT_PATH}")
        return

    total_frames = 0

    # 3. begin 10s
    print("写入 begin (10s) ...")
    write_frames(writer, begin, DUR_BEGIN, FPS)
    total_frames += DUR_BEGIN * FPS

    # 4. 黑屏 30s
    print("写入 黑屏 (30s) ...")
    write_frames(writer, black, DUR_BLACK, FPS)
    total_frames += DUR_BLACK * FPS

    # 5. 三个文件夹
    for i, folder in enumerate(FOLDERS):
        if not os.path.isdir(folder):
            print(f"[WARN] 文件夹不存在: {folder}，跳过")
            continue
        files = [f for f in os.listdir(folder)
                 if f.lower().endswith((".png", ".jpg", ".jpeg"))]
        if len(files) < IMAGES_PER:
            print(f"[WARN] 文件夹 {folder} 仅 {len(files)} 张图，需要 {IMAGES_PER} 张")
        files = sorted(files)[:IMAGES_PER]
        random.shuffle(files)

        print(f"写入 文件夹{i+1} ({len(files)} 张，随机顺序，各 5s) ...")
        for j, fname in enumerate(files):
            path = os.path.join(folder, fname)
            img = load_and_fit(path, WIDTH, HEIGHT)
            if img is None:
                print(f"  [WARN] 跳过无法加载: {fname}")
                continue
            write_frames(writer, img, DUR_IMAGE, FPS)
            total_frames += DUR_IMAGE * FPS

        # 黑屏 30s（最后一个文件夹后也有）
        print(f"写入 黑屏 (30s) ...")
        write_frames(writer, black, DUR_BLACK, FPS)
        total_frames += DUR_BLACK * FPS

    writer.release()
    dur_total = total_frames / FPS
    print(f"\n完成: {OUTPUT_PATH}")
    print(f"总时长: {dur_total:.1f}s ({total_frames} 帧 @ {FPS} fps)")

    # 6. 输出随机顺序供实验记录
    log_path = os.path.join(ROOT, "eeg_stimulus_order.txt")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("EEG 刺激视频图片播放顺序（随机）\n")
        f.write("=" * 60 + "\n")
        random.seed(42)
        for i, folder in enumerate(FOLDERS):
            if not os.path.isdir(folder):
                continue
            files = [f for f in os.listdir(folder)
                     if f.lower().endswith((".png", ".jpg", ".jpeg"))]
            files = sorted(files)[:IMAGES_PER]
            random.shuffle(files)
            f.write(f"\n文件夹 {i+1} ({folder}):\n")
            for k, fn in enumerate(files):
                f.write(f"  {k+1:2d}. {fn}\n")
    print(f"顺序记录: {log_path}")


if __name__ == "__main__":
    main()
