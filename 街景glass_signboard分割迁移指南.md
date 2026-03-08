# 街景 Glass / Signboard 面积统计：从 SAM2 迁移到 MIT 语义分割

> 本文档用于指导将街景图像分割项目从 SAM2 迁移到 MIT Semantic Segmentation (ADE20K)，以提升 glass 和 signboard 的识别效果，并解决低分辨率图像精度差的问题。

---

## 一、问题背景

- **任务**：统计街景图像中 glass（玻璃）和 signboard（招牌）的面积
- **原方案**：使用 SAM2 进行分割
- **问题**：SAM2 效果差，尤其对低分辨率图像识别精度低

---

## 二、推荐方案：MIT 语义分割 + ADE20K

### 2.1 为什么不用 SAM2

| 问题 | 说明 |
|------|------|
| 需要提示 | SAM2 需要点/框/掩码提示，不适合全图自动统计 |
| 低分辨率敏感 | SAM2 对低分辨率图像效果差 |
| 任务不匹配 | 面积统计只需类别标签，不需要 SAM2 的实例级精细掩码 |

### 2.2 为什么用 MIT 语义分割

| 优势 | 说明 |
|------|------|
| 直接输出类别 | 一次前向得到全图 150 类标签，无需提示 |
| 多尺度推理 | 可缓解低分辨率、小目标问题 |
| 类别覆盖 | ADE20K 包含 glass 和 signboard，街景场景适配好 |
| 速度更快 | ResNet 类 backbone 比 SAM2 轻量 |

---

## 三、ADE20K 类别 ID（必用）

ADE20K 共 150 类，glass 和 signboard 的 **0-based 索引**如下：

| 类别 | 索引 (0-based) | 说明 |
|------|----------------|------|
| **signboard** | 43 | 招牌、广告牌 |
| **glass** | 113 | 玻璃 |

**代码中应使用**：`id_list = [43, 113]`

---

## 四、核心实现要点

### 4.1 多尺度推理（解决低分辨率问题）

**原理**：对同一张图生成多个尺度的输入，分别推理后对分数取平均，再取 argmax 得到最终分割。多尺度能覆盖不同大小的目标，提升鲁棒性。

**推荐配置**（来自 `config/ade20k-resnet101dilated-ppm_deepsup.yaml`）：

```yaml
imgSizes: (300, 375, 450, 525, 600)   # 短边尺寸，多尺度
imgMaxSize: 1000                      # 长边最大尺寸
padding_constant: 8                   # 尺寸需为 8 的倍数
```

**多尺度图像生成逻辑**（必须实现）：

```python
def process_frame(frame, imgSizes, imgMaxSize, padding_constant=8):
    img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img_pil = Image.fromarray(img_rgb)
    ori_height, ori_width = img_rgb.shape[:2]

    img_resized_list = []
    for this_short_size in imgSizes:
        scale = min(
            this_short_size / float(min(ori_height, ori_width)),
            imgMaxSize / float(max(ori_height, ori_width))
        )
        target_height = int(ori_height * scale)
        target_width = int(ori_width * scale)
        target_width = round(target_width // padding_constant) * padding_constant
        target_height = round(target_height // padding_constant) * padding_constant

        img_resized = img_pil.resize((target_width, target_height), Image.BILINEAR)
        img_resized = img_transform(img_resized)  # 归一化 + 转 tensor
        img_resized = torch.unsqueeze(img_resized, 0)
        img_resized_list.append(img_resized)

    return {
        'img_ori': img_rgb,
        'img_data': img_resized_list,
    }
```

**推理时对多尺度结果取平均**：

```python
with torch.no_grad():
    scores = torch.zeros(1, num_class, segSize[0], segSize[1]).cuda()
    for img in img_resized_list:
        pred_tmp = segmentation_module({'img_data': img}, segSize=segSize)
        scores = scores + pred_tmp / len(imgSizes)
    _, pred = torch.max(scores, dim=1)
    seg = pred.squeeze(0).cpu().numpy()
```

**注意**：若显存紧张，可只用前 2 个尺度（如 `img_resized_list[0:2]`），效果会略降但可接受。

### 4.2 图像预处理（归一化）

```python
normalize = transforms.Normalize(
    mean=[0.485, 0.456, 0.406],
    std=[0.229, 0.224, 0.225]
)

def img_transform(img):
    img = np.float32(np.array(img)) / 255.
    img = img.transpose((2, 0, 1))
    img = normalize(torch.from_numpy(img.copy()))
    return img
```

### 4.3 面积统计逻辑（简化版，无深度）

原项目按深度区间统计，街景统计可简化为**全图面积占比**：

```python
# 只关心 glass(113) 和 signboard(43)
id_list = [43, 113]
total_pixels = seg.size

glass_pixels = (seg == 113).sum()
signboard_pixels = (seg == 43).sum()

glass_ratio = glass_pixels / total_pixels
signboard_ratio = signboard_pixels / total_pixels

# 或按「非背景像素」占比（若需要）
foreground_pixels = total_pixels - (seg == 150).sum()  # 150 为背景
if foreground_pixels > 0:
    glass_ratio = glass_pixels / foreground_pixels
    signboard_ratio = signboard_pixels / foreground_pixels
```

---

## 五、模型与依赖

### 5.1 模型架构

- **Encoder**：ResNet101 dilated（或 ResNet50 以提速）
- **Decoder**：PPM (Pyramid Pooling Module) + deep supervision
- **预训练**：ADE20K 预训练权重

### 5.2 配置文件示例

```yaml
DATASET:
  num_class: 150
  imgSizes: (300, 375, 450, 525, 600)
  imgMaxSize: 1000
  padding_constant: 8

MODEL:
  arch_encoder: "resnet101dilated"
  arch_decoder: "ppm_deepsup"
  fc_dim: 2048

DIR: "ckpt/ade20k-resnet101dilated-ppm_deepsup"
TEST:
  checkpoint: "epoch_25.pth"
```

### 5.3 依赖

- PyTorch
- torchvision
- OpenCV (cv2)
- PIL (Pillow)
- MIT Semantic Segmentation 代码库（`mit_semseg`）及 ADE20K 预训练权重

---

## 六、迁移步骤清单

请按以下顺序修改代码：

1. **移除 SAM2 相关代码**：包括模型加载、提示生成、SAM2 推理等。

2. **引入 MIT 语义分割**：
   - 复制或引用 `mit_semseg` 模块
   - 加载 ADE20K 预训练权重（encoder + decoder）

3. **实现 `process_frame`**：按 4.1 节实现多尺度图像生成。

4. **实现多尺度推理**：按 4.1 节对多尺度结果取平均。

5. **设置 `id_list = [43, 113]`**：仅统计 glass 和 signboard。

6. **实现面积统计**：按 4.3 节计算 glass_ratio 和 signboard_ratio。

7. **（可选）调整多尺度**：若图像普遍偏小或低分辨率，可适当增大 `imgSizes` 或增加更多尺度。

---

## 七、关键代码片段汇总

```python
# 类别 ID
SIGNBOARD_ID = 43
GLASS_ID = 113
id_list = [SIGNBOARD_ID, GLASS_ID]

# 多尺度配置
imgSizes = (300, 375, 450, 525, 600)
imgMaxSize = 1000

# 面积统计（seg 为 H×W 的类别图，值为 0-149）
def compute_glass_signboard_area(seg):
    total = seg.size
    glass_pixels = (seg == GLASS_ID).sum()
    signboard_pixels = (seg == SIGNBOARD_ID).sum()
    return {
        'glass_ratio': float(glass_pixels / total),
        'signboard_ratio': float(signboard_pixels / total),
        'glass_pixels': int(glass_pixels),
        'signboard_pixels': int(signboard_pixels),
    }
```

---

## 八、预期效果

- **glass / signboard 识别**：ADE20K 在街景场景下通常优于 SAM2
- **低分辨率**：多尺度推理可明显缓解
- **速度**：单张图推理通常快于 SAM2
- **部署**：模型更小，依赖更少

---

## 九、参考来源

本文档基于 DepthPerception 项目中的 MIT 语义分割实现整理，核心逻辑来自：
- `process_frame`：多尺度图像生成
- `VideoThread.run`：多尺度推理与面积统计
- `config/ade20k-resnet101dilated-ppm_deepsup.yaml`：配置参数
