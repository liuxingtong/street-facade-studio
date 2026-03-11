import pandas as pd
import numpy as np

# ===== 读取summary =====
df = pd.read_excel(r"E:\1-result\summary.xlsx")

# ===== 从文件名解析标签 =====
def parse_label(name):
    part = name.split("-")[1]

    w = part[0]  # Transparency
    s = part[2]  # SignageScale
    r = part[4]  # ColorRichness

    return w, s, r

df[["W_label","S_label","R_label"]] = df["file"].apply(
    lambda x: pd.Series(parse_label(x))
)

# ===== 分类函数 =====
def classify(x, a, b):
    if x < a:
        return "l"
    elif x < b:
        return "m"
    else:
        return "h"

# ===== 拟合函数 =====
def fit_threshold(values, labels):

    values = np.array(values)
    best_a = None
    best_b = None
    best_acc = 0

    vmin = values.min()
    vmax = values.max()

    # 搜索阈值
    for a in np.linspace(vmin, vmax, 200):
        for b in np.linspace(a, vmax, 200):

            preds = [classify(v,a,b) for v in values]

            acc = np.mean([p==t for p,t in zip(preds,labels)])

            if acc > best_acc:
                best_acc = acc
                best_a = a
                best_b = b

    return best_a, best_b, best_acc


# ===== 分别拟合三个指标 =====

print("\nFitting Transparency")
Ta,Tb,Tacc = fit_threshold(df["Transparency"], df["W_label"])

print("\nFitting SignageScale")
Sa,Sb,Sacc = fit_threshold(df["SignageScale"], df["S_label"])

print("\nFitting ColorRichness")
Ra,Rb,Racc = fit_threshold(df["ColorRichness"], df["R_label"])


# ===== 输出结果 =====
print("\n===== 分类阈值 =====")

print("\nTransparency")
print("l <", Ta)
print("m", Ta, "~", Tb)
print("h >=", Tb)
print("accuracy =", Tacc)

print("\nSignageScale")
print("l <", Sa)
print("m", Sa, "~", Sb)
print("h >=", Sb)
print("accuracy =", Sacc)

print("\nColorRichness")
print("l <", Ra)
print("m", Ra, "~", Rb)
print("h >=", Rb)
print("accuracy =", Racc)