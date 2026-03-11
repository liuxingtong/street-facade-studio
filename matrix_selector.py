"""
matrix_selector.py — 街景立面 3×3×3 矩阵筛选与导出（多文件夹版）
══════════════════════════════════════════════════════════════════════════════

功能概述
────────
扫描 ROOT_DIR 下的各子文件夹，每个子文件夹独立分析。
采用「三分位预分 + 两阶段分配」：先综合三变量计算三分位阈值做大致划分，
再优先分配严格落在类别内的图片，剩余空格用 MRV 贪心 + 单调性约束补充。

算法
────────
1. 读取 + 归一化（min-max → [0,1]）
2. 三分位阈值（P33.3 / P66.7）→ 初分类
3. 各级别真实中点（该类别内中位数）→ 数据驱动的理想目标
4. 阶段一：严格匹配优先，三维度都落在对应类别内的图片先分配
5. 阶段二：剩余空格用 MRV 贪心，选距理想目标最近且不违反单调性的图
6. 每张图最多分配给一个格子
7. 从实际分配结果反推等效阈值供展示和导出

运行方式
────────
  python matrix_selector.py
"""

import os, re, zipfile, io, warnings, json, shutil
import xml.etree.ElementTree as ET
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from PIL import Image

# ─── 配置 ────────────────────────────────────────────────────────────────────
ROOT_DIR   = r"F:\Aworks\HFE2\result"
LEVELS     = ["l", "m", "h"]
LEVEL_NAME = {"l": "Low", "m": "Mid", "h": "High"}

# 单调性容差（归一化空间）：允许的"反向"差值上限
MONO_TOL = 0.10

# 固定理想目标（当某级别无数据时回退使用）
IDEAL_FALLBACK = {"l": 1/6, "m": 1/2, "h": 5/6}

# ─── xlsx 工具 ───────────────────────────────────────────────────────────────
def read_xlsx_metrics(path):
    """返回 {Transparency, SignageScale, ColorRichness} 或空 dict"""
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    result = {}
    try:
        with zipfile.ZipFile(path) as z:
            ss_root = ET.fromstring(z.read("xl/sharedStrings.xml").decode("utf-8"))
            strings = [
                "".join(t.text or "" for t in si.iter(f"{{{ns}}}t"))
                for si in ss_root.findall(f"{{{ns}}}si")
            ]
            root = ET.fromstring(z.read("xl/worksheets/sheet1.xml").decode("utf-8"))
            for row in root.iter(f"{{{ns}}}row"):
                cells = list(row)
                if len(cells) < 2:
                    continue
                def cell_val(c):
                    t  = c.attrib.get("t", "")
                    ve = c.find(f"{{{ns}}}v")
                    if ve is None: return None
                    if t == "s": return strings[int(ve.text)]
                    try:    return float(ve.text)
                    except: return ve.text
                a_cells = [c for c in cells if c.attrib.get("r","").startswith("A")]
                b_cells = [c for c in cells if c.attrib.get("r","").startswith("B")]
                if not a_cells or not b_cells: continue
                key = cell_val(a_cells[0])
                val = cell_val(b_cells[0])
                if key in ("Transparency", "SignageScale", "ColorRichness") and val is not None:
                    result[key] = float(val)
    except Exception as e:
        print(f"    [WARN] {os.path.basename(path)}: {e}")
    return result


def read_xlsx_image(path):
    """提取 xlsx 中第一张嵌入图（原始立面图）"""
    try:
        with zipfile.ZipFile(path) as z:
            imgs = sorted(n for n in z.namelist()
                          if re.match(r"xl/media/image\d+\.(png|jpg|jpeg)", n))
            if not imgs: return None
            return Image.open(io.BytesIO(z.read(imgs[0]))).convert("RGB")
    except: return None


def load_folder(folder_path):
    """读取一个文件夹内所有有效 xlsx，返回 records 列表"""
    records = []
    files = sorted(f for f in os.listdir(folder_path)
                   if f.endswith(".xlsx") and not f.startswith("~$"))
    for fname in files:
        path = os.path.join(folder_path, fname)
        stem = os.path.splitext(fname)[0]
        m = read_xlsx_metrics(path)
        T, S_raw, CR = m.get("Transparency"), m.get("SignageScale"), m.get("ColorRichness")
        if None in (T, S_raw, CR):
            print(f"    [SKIP] {fname} — 缺失指标")
            continue
        S = S_raw / 3
        records.append(dict(file=fname, path=path, stem=stem, T=T, S=S, CR=CR))
    return records

# ─── 归一化 ──────────────────────────────────────────────────────────────────
def normalize_records(records):
    """min-max 归一化 → T_n / S_n / CR_n ∈ [0,1]"""
    norm_params = {}
    for col in ("T", "S", "CR"):
        vals = np.array([r[col] for r in records], float)
        vmin, vmax = float(vals.min()), float(vals.max())
        norm_params[col] = (vmin, vmax)
        span = vmax - vmin
        for r in records:
            r[f"{col}_n"] = (r[col] - vmin) / span if span > 1e-12 else 0.5
    return norm_params


def denorm(v_n, vmin, vmax):
    return vmin + v_n * (vmax - vmin)

# ─── 三分位阈值与数据驱动理想目标 ─────────────────────────────────────────
def compute_tercile_thresholds(records):
    """基于归一化值计算三分位阈值，返回 [0,1] 空间的 (a, b)"""
    thresholds = {}
    for col in ("T", "S", "CR"):
        vals = np.array([r[f"{col}_n"] for r in records], float)
        a = float(np.percentile(vals, 33.3))
        b = float(np.percentile(vals, 66.7))
        thresholds[col] = (a, b)
    return thresholds


def classify(v_n, a, b):
    return "l" if v_n < a else ("m" if v_n < b else "h")


def compute_ideal_targets(records, thresholds):
    """
    根据三分位初分类，取各级别内数据的中位数作为理想目标。
    若某级别无数据，回退到固定值 1/6, 1/2, 5/6。
    返回 {col: {lv: target}}，如 {"T": {"l": 0.15, "m": 0.48, "h": 0.82}}
    """
    ideal = {}
    for col in ("T", "S", "CR"):
        a, b = thresholds[col]
        vals = {"l": [], "m": [], "h": []}
        for r in records:
            v = r[f"{col}_n"]
            lv = classify(v, a, b)
            vals[lv].append(v)
        ideal[col] = {}
        for lv in LEVELS:
            if vals[lv]:
                ideal[col][lv] = float(np.median(vals[lv]))
            else:
                ideal[col][lv] = IDEAL_FALLBACK[lv]
    return ideal


# ─── 矩阵构建（两阶段：严格匹配 + MRV 贪心）──────────────────────────────────
LEVEL_ORD = {"l": 0, "m": 1, "h": 2}


def _dist(r, t, s, cr, ideal):
    """欧氏距离到理想目标点（归一化空间）"""
    return ((r["T_n"] - ideal["T"][t])**2
          + (r["S_n"] - ideal["S"][s])**2
          + (r["CR_n"] - ideal["CR"][cr])**2) ** 0.5


def _contradicts(r, t, s, cr, assigned):
    """检查把 r 放入 (t,s,cr) 是否与已分配格产生明显矛盾"""
    for (t2, s2, cr2), r2 in assigned.items():
        for d, lv1, lv2 in [("T_n", t, t2), ("S_n", s, s2), ("CR_n", cr, cr2)]:
            o1, o2 = LEVEL_ORD[lv1], LEVEL_ORD[lv2]
            if o1 > o2 and r[d] < r2[d] - MONO_TOL:
                return True
            if o1 < o2 and r[d] > r2[d] + MONO_TOL:
                return True
    return False


def _contradicts_tol(r, t, s, cr, assigned, tol):
    """与 _contradicts 相同但使用自定义容差"""
    for (t2, s2, cr2), r2 in assigned.items():
        for d, lv1, lv2 in [("T_n", t, t2), ("S_n", s, s2), ("CR_n", cr, cr2)]:
            o1, o2 = LEVEL_ORD[lv1], LEVEL_ORD[lv2]
            if o1 > o2 and r[d] < r2[d] - tol:
                return True
            if o1 < o2 and r[d] > r2[d] + tol:
                return True
    return False


def _mrv_greedy(records, remaining, assigned, used_paths, ideal, tol):
    """一轮 MRV 贪心，使用给定容差。返回新填入的格数。"""
    filled = 0
    while remaining:
        cell_options = {}
        for key in remaining:
            t, s, cr = key
            viable = sorted(
                [(_dist(r, t, s, cr, ideal), r)
                 for r in records
                 if r["path"] not in used_paths
                 and not _contradicts_tol(r, t, s, cr, assigned, tol)],
                key=lambda x: x[0],
            )
            if viable:
                cell_options[key] = viable
        if not cell_options:
            break
        key = min(cell_options, key=lambda k: len(cell_options[k]))
        _, best = cell_options[key][0]
        assigned[key] = best
        used_paths.add(best["path"])
        remaining.discard(key)
        filled += 1
    return filled


def build_matrix(records, ideal):
    """
    四阶段分配，逐步放松以尽量填满 27 格：

    1. 严格匹配：三维都落在三分位类别内的图片优先分配（MRV）
    2. MRV 贪心（MONO_TOL）：用标准单调性容差补充
    3. 渐进放松：逐步增大容差（+0.10 直到 1.0），对仍空的格子继续 MRV 贪心
    4. 允许复用：若图片不足 27 张，对仍空的格子从所有图片中选距离最近的
    """
    all_cells  = [(t, s, cr) for t in LEVELS for s in LEVELS for cr in LEVELS]
    assigned   = {}
    used_paths = set()

    # ── 阶段一：严格匹配（MRV） ──
    phase1_pool = set(all_cells)
    while phase1_pool:
        cell_strict = {}
        for key in phase1_pool:
            t, s, cr = key
            cands = [r for r in records if r["path"] not in used_paths
                     and r["T_cls"] == t and r["S_cls"] == s and r["CR_cls"] == cr]
            if cands:
                cell_strict[key] = cands
        if not cell_strict:
            break
        key = min(cell_strict, key=lambda k: len(cell_strict[k]))
        t, s, cr = key
        best = min(cell_strict[key], key=lambda r: _dist(r, t, s, cr, ideal))
        assigned[key] = best
        used_paths.add(best["path"])
        phase1_pool.discard(key)

    remaining = set(all_cells) - set(assigned.keys())
    p1 = len(assigned)

    # ── 阶段二：MRV 贪心（标准容差） ──
    _mrv_greedy(records, remaining, assigned, used_paths, ideal, MONO_TOL)
    p2 = len(assigned) - p1

    # ── 阶段三：渐进放松容差 ──
    p3 = 0
    if remaining:
        tol = MONO_TOL + 0.10
        while remaining and tol <= 1.0 + 1e-9:
            n = _mrv_greedy(records, remaining, assigned, used_paths, ideal, tol)
            p3 += n
            if not remaining:
                break
            tol = round(tol + 0.10, 2)

    # ── 阶段四：允许复用（图片总数 < 27 时）──
    p4 = 0
    if remaining:
        for key in list(remaining):
            t, s, cr = key
            best = min(records, key=lambda r: _dist(r, t, s, cr, ideal))
            assigned[key] = best
            remaining.discard(key)
            p4 += 1

    print(f"    分配统计: 阶段一(严格) {p1}  阶段二(MRV) {p2}"
          f"  阶段三(放松) {p3}  阶段四(复用) {p4}")

    return {k: assigned.get(k) for k in all_cells}

# ─── 从分配结果推导等效阈值 ─────────────────────────────────────────────────
def derive_thresholds(matrix):
    """
    根据实际分配到各级别的记录，推导等效阈值（归一化空间）。
    阈值 a = Low 最大值与 Mid 最小值的中点，b = Mid 最大值与 High 最小值的中点。
    """
    thresholds = {}
    for idx, col in enumerate(("T", "S", "CR")):
        lv_vals = {"l": [], "m": [], "h": []}
        for (t, s, cr), rec in matrix.items():
            if rec is None:
                continue
            lv = (t, s, cr)[idx]
            lv_vals[lv].append(rec[f"{col}_n"])

        lo = lv_vals["l"]; mi = lv_vals["m"]; hi = lv_vals["h"]

        if lo and mi:
            a = (max(lo) + min(mi)) / 2
        elif mi:
            a = min(mi)
        elif lo:
            a = max(lo)
        else:
            a = 1 / 3

        if mi and hi:
            b = (max(mi) + min(hi)) / 2
        elif hi:
            b = min(hi)
        elif mi:
            b = max(mi)
        else:
            b = 2 / 3

        if a >= b:
            a, b = 1 / 3, 2 / 3
        thresholds[col] = (float(a), float(b))
    return thresholds

# ─── 可视化 ───────────────────────────────────────────────────────────────────
def draw_matrix(matrix, thresholds, norm_params, title_prefix, out_path):
    def dn(v_n, col): return denorm(v_n, *norm_params[col])
    Ta_v, Tb_v = dn(thresholds["T"][0], "T"),  dn(thresholds["T"][1], "T")
    Sa_v, Sb_v = dn(thresholds["S"][0], "S"),  dn(thresholds["S"][1], "S")
    Ra_v, Rb_v = dn(thresholds["CR"][0],"CR"), dn(thresholds["CR"][1],"CR")

    fig = plt.figure(figsize=(15, 13), facecolor="#1a1a1a")
    fig.suptitle(
        f"{title_prefix}\n"
        f"T: <{Ta_v:.1f} / [{Ta_v:.1f},{Tb_v:.1f}) / ≥{Tb_v:.1f}  |  "
        f"S: <{Sa_v:.1f} / [{Sa_v:.1f},{Sb_v:.1f}) / ≥{Sb_v:.1f}  |  "
        f"CR: <{Ra_v:.1f} / [{Ra_v:.1f},{Rb_v:.1f}) / ≥{Rb_v:.1f}",
        color="#eee", fontsize=9, y=0.98
    )
    outer     = fig.add_gridspec(1, 3, wspace=0.08, left=0.06, right=0.97,
                                 top=0.90, bottom=0.04)
    cr_colors = {"l": "#4db6e4", "m": "#f0c500", "h": "#e44d4d"}
    t_edge    = {"l": "#4db6e4", "m": "#f0c500", "h": "#e44d4d"}

    for ci, cr in enumerate(LEVELS):
        inner = outer[ci].subgridspec(3, 3, wspace=0.04, hspace=0.18)
        ax_title = fig.add_subplot(outer[ci])
        ax_title.set_facecolor("#1a1a1a")
        ax_title.set_xticks([]); ax_title.set_yticks([])
        for spine in ax_title.spines.values():
            spine.set_edgecolor(cr_colors[cr]); spine.set_linewidth(2)
        ax_title.set_title(f"ColorRichness = {LEVEL_NAME[cr]}",
                           color=cr_colors[cr], fontsize=11, fontweight="bold", pad=8)

        for si, s in enumerate(LEVELS):
            for ti, t in enumerate(LEVELS):
                ax  = fig.add_subplot(inner[si, ti])
                ax.set_facecolor("#111")
                rec = matrix[(t, s, cr)]

                if rec is None:
                    ax.text(0.5, 0.5, "N/A", ha="center", va="center",
                            color="#555", fontsize=9, transform=ax.transAxes)
                    for sp in ax.spines.values():
                        sp.set_edgecolor("#333"); sp.set_linewidth(0.8)
                else:
                    img = read_xlsx_image(rec["path"])
                    if img:
                        ax.imshow(img, aspect="auto")
                    ax.set_title(
                        f"T={rec['T']:.1f} S={rec['S']:.1f} CR={rec['CR']:.1f}",
                        fontsize=6, color="#ccc", pad=2
                    )
                    for sp in ax.spines.values():
                        sp.set_edgecolor(t_edge[t]); sp.set_linewidth(1.8)
                ax.set_xticks([]); ax.set_yticks([])
                if ti == 0:
                    ax.set_ylabel(f"S={LEVEL_NAME[s]}", color="#aaa", fontsize=7, labelpad=3)
                if si == 0:
                    ax.xaxis.set_label_position("top")
                    ax.set_xlabel(f"T={LEVEL_NAME[t]}", color="#aaa", fontsize=7, labelpad=2)

    patches = [mpatches.Patch(color=t_edge[k], label=f"T={LEVEL_NAME[k]}")
               for k in LEVELS]
    fig.legend(handles=patches, loc="lower center", ncol=3,
               fontsize=8, facecolor="#222", labelcolor="#ccc",
               framealpha=0.8, bbox_to_anchor=(0.5, 0.0))

    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close()

# ─── 导出 ────────────────────────────────────────────────────────────────────
def export_matrix(records, matrix, thresholds, norm_params, export_dir, tercile_th=None):
    os.makedirs(export_dir, exist_ok=True)
    img_dir = os.path.join(export_dir, "images")
    os.makedirs(img_dir, exist_ok=True)

    saved = 0
    for t in LEVELS:
        for s in LEVELS:
            for cr in LEVELS:
                rec = matrix[(t, s, cr)]
                if rec is None: continue
                name = f"T-{LEVEL_NAME[t]}_S-{LEVEL_NAME[s]}_CR-{LEVEL_NAME[cr]}.png"
                img  = read_xlsx_image(rec["path"])
                if img:
                    img.save(os.path.join(img_dir, name))
                    saved += 1
    print(f"    已保存 {saved} 张图片 → images/")

    cell_map = {}
    for (t, s, cr), rec in matrix.items():
        if rec and rec["path"] not in cell_map:
            cell_map[rec["path"]] = f"T-{LEVEL_NAME[t]}_S-{LEVEL_NAME[s]}_CR-{LEVEL_NAME[cr]}"

    csv_path = os.path.join(export_dir, "data.csv")
    with open(csv_path, "w", encoding="utf-8-sig") as f:
        f.write("source_file,Transparency,SignageScale,ColorRichness,"
                "T_class,S_class,CR_class,matrix_cell\n")
        for r in records:
            cell = cell_map.get(r["path"], "")
            f.write(f"{r['file']},{r['T']},{r['S']},{r['CR']},"
                    f"{LEVEL_NAME[r['T_cls']]},{LEVEL_NAME[r['S_cls']]},"
                    f"{LEVEL_NAME[r['CR_cls']]},{cell}\n")
    print(f"    已保存: data.csv")

    def dn(v_n, col): return round(denorm(v_n, *norm_params[col]), 4)
    th_json = {
        "note": "等效阈值由分配结果反推；初划分使用三分位阈值",
        "Transparency":  {
            "low_upper_norm": round(thresholds["T"][0], 4),
            "high_lower_norm": round(thresholds["T"][1], 4),
            "raw_min": norm_params["T"][0], "raw_max": norm_params["T"][1],
            "low_upper_raw":  dn(thresholds["T"][0], "T"),
            "high_lower_raw": dn(thresholds["T"][1], "T"),
        },
        "SignageScale":  {
            "low_upper_norm": round(thresholds["S"][0], 4),
            "high_lower_norm": round(thresholds["S"][1], 4),
            "raw_min": norm_params["S"][0], "raw_max": norm_params["S"][1],
            "low_upper_raw":  dn(thresholds["S"][0], "S"),
            "high_lower_raw": dn(thresholds["S"][1], "S"),
        },
        "ColorRichness": {
            "low_upper_norm": round(thresholds["CR"][0], 4),
            "high_lower_norm": round(thresholds["CR"][1], 4),
            "raw_min": norm_params["CR"][0], "raw_max": norm_params["CR"][1],
            "low_upper_raw":  dn(thresholds["CR"][0], "CR"),
            "high_lower_raw": dn(thresholds["CR"][1], "CR"),
        },
        "rule": "等效阈值由矩阵分配结果反推；初划分用三分位",
        "mono_tolerance": MONO_TOL,
    }
    if tercile_th:
        th_json["tercile_initial"] = {
            col: {"low_upper_norm": round(tercile_th[col][0], 4),
                  "high_lower_norm": round(tercile_th[col][1], 4)}
            for col in ("T", "S", "CR")
        }
    with open(os.path.join(export_dir, "thresholds.json"), "w", encoding="utf-8") as f:
        json.dump(th_json, f, indent=2, ensure_ascii=False)
    print(f"    已保存: thresholds.json")

# ─── 主流程 ──────────────────────────────────────────────────────────────────
def main():
    subfolders = sorted(
        d for d in os.listdir(ROOT_DIR)
        if os.path.isdir(os.path.join(ROOT_DIR, d))
        and not d.startswith(".")
        and d not in ("matrix_export",)
    )
    if not subfolders:
        print(f"[ERR] {ROOT_DIR} 下未找到子文件夹。")
        return
    print(f"发现 {len(subfolders)} 个子文件夹: {', '.join(subfolders)}\n")

    for sub in subfolders:
        folder_path = os.path.join(ROOT_DIR, sub)
        print(f"\n{'='*62}")
        print(f"  子文件夹: {sub}")
        print(f"{'='*62}")

        recs = load_folder(folder_path)
        print(f"  有效文件: {len(recs)} 个")
        if not recs:
            print("  [SKIP] 无有效文件，跳过。")
            continue

        # 归一化
        norm_params = normalize_records(recs)
        long_names  = {"T": "Transparency", "S": "SignageScale", "CR": "ColorRichness"}
        print(f"\n  归一化范围（min-max → [0,1]）")
        for col in ("T", "S", "CR"):
            vmin, vmax = norm_params[col]
            print(f"    {long_names[col]:14s}: [{vmin:.1f}, {vmax:.1f}]")

        # 三分位阈值 + 初分类 + 数据驱动理想目标
        tercile_th = compute_tercile_thresholds(recs)
        for r in recs:
            r["T_cls"]  = classify(r["T_n"],  *tercile_th["T"])
            r["S_cls"]  = classify(r["S_n"],  *tercile_th["S"])
            r["CR_cls"] = classify(r["CR_n"], *tercile_th["CR"])
        ideal = compute_ideal_targets(recs, tercile_th)

        print(f"\n  三分位阈值（初划分）")
        for col in ("T", "S", "CR"):
            a_n, b_n = tercile_th[col]
            a_raw = denorm(a_n, *norm_params[col])
            b_raw = denorm(b_n, *norm_params[col])
            print(f"    {long_names[col]:14s}: 归一化 {a_n:.3f}/{b_n:.3f}"
                  f"  ≈ 原始 {a_raw:.1f}/{b_raw:.1f}")
        print(f"  理想目标（各级别中位数）: T {ideal['T']}  S {ideal['S']}  CR {ideal['CR']}")

        # 两阶段分配
        matrix = build_matrix(recs, ideal)

        # 从分配结果反推等效阈值（供展示和 data.csv 分类）
        thresholds = derive_thresholds(matrix)
        print(f"\n  等效阈值（由分配结果反推）")
        for col in ("T", "S", "CR"):
            a_n, b_n = thresholds[col]
            a_raw = denorm(a_n, *norm_params[col])
            b_raw = denorm(b_n, *norm_params[col])
            print(f"    {long_names[col]:14s}: 归一化 {a_n:.3f}/{b_n:.3f}"
                  f"  ≈ 原始 {a_raw:.1f}/{b_raw:.1f}")

        # 用等效阈值对全部记录分类（供 data.csv）
        for r in recs:
            r["T_cls"]  = classify(r["T_n"],  *thresholds["T"])
            r["S_cls"]  = classify(r["S_n"],  *thresholds["S"])
            r["CR_cls"] = classify(r["CR_n"], *thresholds["CR"])

        # 打印矩阵摘要
        print(f"\n  矩阵摘要")
        print(f"  {'':28s} {'T=Low':^20s} {'T=Mid':^20s} {'T=High':^20s}")
        for cr in LEVELS:
            print(f"\n    [CR={LEVEL_NAME[cr]}]")
            for s in LEVELS:
                row = f"    S={LEVEL_NAME[s]:4s}: "
                for t in LEVELS:
                    rec = matrix[(t, s, cr)]
                    cell = rec["stem"][:16] if rec else "N/A"
                    row += f"  {cell:18s}"
                print(row)

        filled  = sum(1 for v in matrix.values() if v is not None)
        missing = [k for k, v in matrix.items() if v is None]
        print(f"\n  覆盖: {filled}/27 格有图片")
        if missing:
            print(f"  [!] {len(missing)} 格仍为 N/A:")
            for t, s, cr in missing:
                print(f"      T={LEVEL_NAME[t]}, S={LEVEL_NAME[s]}, CR={LEVEL_NAME[cr]}")

        # 可视化
        png_path = os.path.join(folder_path, "matrix_result.png")
        draw_matrix(matrix, thresholds, norm_params, f"Facade Matrix — {sub}", png_path)
        print(f"\n  → 可视化: {png_path}")

        # 导出
        export_dir = os.path.join(folder_path, "matrix_export")
        print(f"  → 导出到: {export_dir}")
        export_matrix(recs, matrix, thresholds, norm_params, export_dir, tercile_th=tercile_th)
        shutil.copy2(png_path, os.path.join(export_dir, "matrix_result.png"))

    print(f"\n全部完成。")


if __name__ == "__main__":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        main()
