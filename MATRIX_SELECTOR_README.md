# matrix_selector.py — 街景立面矩阵筛选（多文件夹版）

## 功能概述

扫描 `ROOT_DIR`（默认 `F:\Aworks\HFE2\result`）下的所有子文件夹，
每个子文件夹视为一组独立实验数据，分别输出一张 3×3×3 矩阵和结构化导出。

**阈值策略**：三个子文件夹数据合并，联合计算三分位阈值（全局统一），
确保同一分类标准跨文件夹可比。每个子文件夹内独立选代表图，
本文件夹内没有满足该格条件的图片则保持 N/A，不跨文件夹借用。

---

## 目录结构要求

```
F:\Aworks\HFE2\result\
├── 子文件夹A\      ← 每个子文件夹包含若干 .xlsx
│   ├── 1.xlsx
│   └── 2.xlsx
├── 子文件夹B\
│   └── ...
└── 子文件夹C\
    └── ...
```

---

## 运行方式

```bash
python matrix_selector.py
```

依赖：`numpy`, `matplotlib`, `Pillow`（其余均为标准库）

---

## 处理流程

1. **发现子文件夹**：扫描 `ROOT_DIR` 下的直接子目录（排除 `.` 开头和 `matrix_export`）。

2. **读取指标**：对每个子文件夹，解析其 `.xlsx` 中的 `Transparency`、`SignageScale`、`ColorRichness`。

3. **全局阈值**：将所有子文件夹的数据合并，取三分位数（P33.3 / P66.7）作为
   低/中/高的分界线。同一份 `thresholds.json` 存到 `ROOT_DIR`。

4. **逐文件夹处理**：
   - 用全局阈值对本文件夹每条记录分类（T_cls / S_cls / CR_cls）。
   - 为 27 个 (T×S×CR) 格在本文件夹内选代表图（与"理想中点"偏差最小的）。
   - 本文件夹没有候选的格子标为 N/A，不借用其他文件夹的图片。

5. **输出**（每个子文件夹独立）：
   - `{子文件夹}/matrix_result.png`：3×3 子图可视化
   - `{子文件夹}/matrix_export/`：结构化导出（见下方）

---

## 分类规则

```
v < low_upper          → Low
low_upper ≤ v < high_lower → Mid
v ≥ high_lower          → High
```

阈值由全部数据三分位推断，在 `thresholds.json` 中记录。

---

## 导出结构

```
ROOT_DIR/
├── thresholds.json               ← 全局阈值（所有文件夹共用）
├── {子文件夹A}/
│   ├── matrix_result.png
│   └── matrix_export/
│       ├── images/
│       │   ├── T-Low_S-Low_CR-Low.png
│       │   └── ...（最多 27 张，N/A 格跳过）
│       ├── data.csv              ← 本文件夹所有文件指标 + 分类 + 是否被选为代表
│       ├── thresholds.json       ← 同全局阈值，方便独立查阅
│       └── matrix_result.png
├── {子文件夹B}/  ...
└── {子文件夹C}/  ...
```

### data.csv 字段

| 字段 | 说明 |
|------|------|
| source_file | xlsx 文件名 |
| Transparency | 透明度数值 |
| SignageScale | 标牌尺度数值 |
| ColorRichness | 色彩丰富度数值 |
| T_class / S_class / CR_class | 该文件被分入的类别（Low/Mid/High） |
| matrix_cell | 若被选为矩阵代表，此处注明对应格（如 `T-Low_S-Mid_CR-High`），否则为空 |

---

## 空格说明

若某文件夹某格确实没有数据，该格在可视化和 data.csv 中均标为 N/A / 空。
可通过增大各文件夹数据量来减少空格，但不会强制跨文件夹填充。
