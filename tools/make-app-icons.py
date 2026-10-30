# tools/make-app-icons.py —— 从工作空间源图生成各平台应用图标
#
# 用法：py tools/make-app-icons.py
# 依赖：Pillow（py 解释器自带；WorkBuddy 内置 python 无 Pillow）
#
# 源图（工作空间根目录，用户直接替换即可重新生成）：
#   icon.png    —— 应用图标（青绿渐变底 + 白色守宫剪影，四角透明）
#                  → APK 各密度 mipmap（legacy + 自适应背景层）+ exe 的 icon.ico + Web 图标
#   logo-g.png  —— 品牌 logo（绿色渐变守宫，透明底）→ 导航页 logo + 安卓启动页 logo
#
# v3.5 变更：自适应图标的背景层改用 icon.png 自身的青绿渐变（此前为纯白 #FFFFFF），
#   前景层改为从 icon.png 提取的白色守宫 —— 保证 Android 8+ 的启动器图标与 icon.png 一致。
#
# 产出：
#   android/app/src/main/res/mipmap-*/ic_launcher.png          （legacy 方形图标）
#   android/app/src/main/res/mipmap-*/ic_launcher_round.png    （圆形图标）
#   android/app/src/main/res/mipmap-*/ic_launcher_bg.png        （自适应图标背景层，青绿渐变）
#   android/app/src/main/res/mipmap-*/ic_launcher_foreground.png（自适应图标前景层，白色守宫）
#   android/app/src/main/res/drawable-nodpi/splash_logo.png     （启动页 logo）
#   icons/logo-g.png                                           （Web 导航 logo）
#   icons/icon-192.png / icon-512.png / apple-touch-180.png    （PWA 图标，全部改用 icon.png）
#   icon.ico                                                  （exe 打包用，多尺寸）
import os
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
ICONS = os.path.join(ROOT, 'icons')

ICON_SRC = os.path.join(ROOT, 'icon.png')
LOGO_SRC = os.path.join(ROOT, 'logo-g.png')

# legacy 图标密度：目录后缀 → 边长(px)
DENSITIES = [
    ('mdpi', 48),
    ('hdpi', 72),
    ('xhdpi', 96),
    ('xxhdpi', 144),
    ('xxxhdpi', 192),
]
# 自适应图标前景层：108dp 画布（mdpi=108px），内容须落在中心 66dp 安全区内
FOREGROUND = [
    ('mdpi', 108),
    ('hdpi', 162),
    ('xhdpi', 216),
    ('xxhdpi', 324),
    ('xxxhdpi', 432),
]


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)
    print('  OK', os.path.relpath(path, ROOT), img.size, f'{os.path.getsize(path) // 1024}KB')


def circle_mask(size):
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def extract_lizard_mask(src):
    """从 logo-g.png（透明底 + 绿色守宫）提取守宫轮廓遮罩。

    logo-g.png 背景完全透明，直接用 alpha 通道做遮罩最干净；
    icon.png 内部含奶白色区域，按亮度抠图会带出矩形杂块，故不使用。
    """
    im = Image.open(src).convert('RGBA')
    a = im.getchannel('A')
    # 轻度收边：去掉极低 alpha 的抗锯齿毛刺
    a = a.point(lambda v: 0 if v < 12 else v)
    return a


# ---------- v3.5：从 icon.png 提取白色守宫遮罩 + 拟合青绿渐变背景 ----------

def white_lizard_mask(icon):
    """从 icon.png 提取「白色守宫」的柔化遮罩。

    icon.png 底色为青绿渐变、守宫为纯白（r,g,b 接近 255），
    用「接近白且不透明」的程度作为 alpha 强度，可得到边缘柔和的守宫轮廓。

    v3.6 修复：透明圆角外的白底（RGB=255 但 alpha=0）在抗锯齿边缘处
    会残留 1~114 的杂散强度，把遮罩 bbox 撑到图像边缘 (2048,2048)，
    导致前景层里的守宫被缩小并偏到左上角。**必须取最大连通块**，
    把零散残留全部剔除，只保留守宫本体。
    """
    r, g, b, a = icon.split()
    # 逐像素取 min(r,g,b)：越接近白色 → 越可能是守宫
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    # 190 → 全透明；250 → 全不透明；中间线性过渡
    strength = mn.point(lambda v: 0 if v <= 190 else (255 if v >= 250 else int((v - 190) / 60.0 * 255)))
    # 与原 alpha 通道相乘（去掉透明角）
    mask = ImageChops.multiply(strength, a)
    # 清理极低强度的抗锯齿残留
    mask = mask.point(lambda v: 0 if v < 40 else v)
    # v3.6：取最大连通块，剔除与守宫不相连的杂散像素
    return largest_component(mask)


def largest_component(mask, thresh=40):
    """返回二值遮罩中面积最大的 4 邻域连通块（其余像素清零）。

    用逐行扫描 + BFS 实现，无需 scipy/numpy。
    """
    W, H = mask.size
    px = mask.load()
    seen = bytearray(W * H)
    best = None
    best_area = 0
    for y0 in range(H):
        row = px  # 局部别名，减少属性查找
        for x0 in range(W):
            i0 = y0 * W + x0
            if seen[i0] or row[x0, y0] <= thresh:
                continue
            q = deque([(x0, y0)])
            seen[i0] = 1
            comp = []
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H:
                        j = ny * W + nx
                        if not seen[j] and px[nx, ny] > thresh:
                            seen[j] = 1
                            q.append((nx, ny))
            if len(comp) > best_area:
                best_area = len(comp)
                best = comp
    out = Image.new('L', (W, H), 0)
    if best:
        op = out.load()
        for x, y in best:
            op[x, y] = 255
    return out


def mask_centroid(mask, step=2):
    """计算遮罩的 alpha 加权质心（视觉重心），返回 (cx, cy)。"""
    W, H = mask.size
    px = mask.load()
    sx = sy = sw = 0.0
    for y in range(0, H, step):
        for x in range(0, W, step):
            v = px[x, y]
            if v:
                sx += x * v
                sy += y * v
                sw += v
    if not sw:
        return (W / 2.0, H / 2.0)
    return (sx / sw, sy / sw)


def _solve(a, b):
    """高斯消元解线性方程组（a 为 n×n，b 为 n 阶列向量），返回解列表。"""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            continue
        m[col], m[piv] = m[piv], m[col]
        pv = m[col][col]
        for r in range(n):
            if r == col:
                continue
            f = m[r][col] / pv
            if f == 0:
                continue
            for c in range(col, n + 1):
                m[r][c] -= f * m[col][c]
    return [m[i][n] / m[i][i] if abs(m[i][i]) > 1e-12 else 0.0 for i in range(n)]


def fit_gradient(icon, sample_step=16):
    """用 icon.png 的背景像素拟合 2D 二次多项式渐变（每通道一组系数）。

    基函数：[1, x, y, x², x·y, y²]（x,y 归一化到 0..1）
    守宫（近白）与透明角被排除在采样之外。
    """
    W, H = icon.size
    px = icon.load()
    rows = []
    for y in range(0, H, sample_step):
        for x in range(0, W, sample_step):
            pr, pg, pb, pa = px[x, y]
            if pa < 250:
                continue
            if pr > 225 and pg > 225 and pb > 225:
                continue    # 守宫
            u = x / (W - 1)
            v = y / (H - 1)
            rows.append(([1.0, u, v, u * u, u * v, v * v], (pr, pg, pb)))
    n = 6
    ata = [[0.0] * n for _ in range(n)]
    atb = [[0.0, 0.0, 0.0] for _ in range(n)]
    for basis, rgb in rows:
        for i in range(n):
            for j in range(n):
                ata[i][j] += basis[i] * basis[j]
            for c in range(3):
                atb[i][c] += basis[i] * rgb[c]
    coef = [_solve([row[:] for row in ata], [atb[i][c] for i in range(n)]) for c in range(3)]
    return coef


def render_gradient(coef, size):
    """按拟合出的渐变系数渲染不透明背景图（size×size）。"""
    img = Image.new('RGBA', (size, size))
    px = img.load()
    for y in range(size):
        v = y / (size - 1) if size > 1 else 0.0
        for x in range(size):
            u = x / (size - 1) if size > 1 else 0.0
            basis = (1.0, u, v, u * u, u * v, v * v)
            vals = []
            for c in range(3):
                val = sum(coef[c][i] * basis[i] for i in range(6))
                vals.append(max(0, min(255, int(round(val)))))
            px[x, y] = (vals[0], vals[1], vals[2], 255)
    return img


def compose_centered(bg, lizard_rgba, shape_alpha, size):
    """合成「渐变背景 + 居中白色守宫」并套上原始圆角轮廓。

    v3.6：所有形态（legacy 方形/圆形、自适应前景、web 图标、exe 图标）
    统一由此函数产出，保证主体在各形态下都位于正中间。
    """
    W, H = bg.size
    scale = size / float(W)
    # 守宫按质心对齐画布中心
    nw = max(1, int(lizard_rgba.size[0] * scale))
    nh = max(1, int(lizard_rgba.size[1] * scale))
    art = lizard_rgba.resize((nw, nh), Image.LANCZOS)
    ox = int(round(size / 2.0 - rcx_global * nw))
    oy = int(round(size / 2.0 - rcy_global * nh))
    out = bg.resize((size, size), Image.LANCZOS).convert('RGBA')
    out.paste(art, (ox, oy), art)
    if shape_alpha is not None:
        out.putalpha(shape_alpha.resize((size, size), Image.LANCZOS))
    return out


def main():
    if not os.path.exists(ICON_SRC):
        sys.exit('缺少 icon.png：' + ICON_SRC)
    if not os.path.exists(LOGO_SRC):
        sys.exit('缺少 logo-g.png：' + LOGO_SRC)

    icon = Image.open(ICON_SRC).convert('RGBA')

    print('== 拟合 icon.png 青绿渐变背景 ==')
    coef = fit_gradient(icon)
    # 先在较大尺寸渲染再缩放，避免逐像素大图过慢
    grad_master = render_gradient(coef, 1024)

    print('== 提取 icon.png 白色守宫（连通域去杂）==')
    wmask = white_lizard_mask(icon)
    bbox = wmask.getbbox()
    if not bbox:
        sys.exit('未能从 icon.png 中提取到白色守宫，请检查源图')
    # v3.6：守宫的 alpha 加权质心（视觉重心）。守宫是趴姿、身体偏上，
    #   bbox 中心比视觉重心低约 90px（原图尺度）；按 bbox 居中会让守宫
    #   在圆形裁切后明显偏上。按质心对齐才能真正「主体在正中间」。
    cx, cy = mask_centroid(wmask)
    print(f'  守宫 bbox={bbox} 质心=({cx:.0f},{cy:.0f})')
    wmask = wmask.crop(bbox)
    lw, lh = wmask.size
    # 质心在裁剪后遮罩内的相对位置（全局变量供 compose_centered 使用）
    global rcx_global, rcy_global
    rcx_global = (cx - bbox[0]) / float(lw)
    rcy_global = (cy - bbox[1]) / float(lh)

    # 白色守宫 RGBA（RGB 全白，alpha 取遮罩），保持裁剪后的原始比例
    lizard = Image.merge('RGBA', (
        Image.new('L', (lw, lh), 255),
        Image.new('L', (lw, lh), 255),
        Image.new('L', (lw, lh), 255),
        wmask,
    ))
    # icon.png 的圆角轮廓（alpha 通道）—— legacy/web 图标沿用，保证外观一致
    shape_alpha = icon.getchannel('A')

    print('== 自适应图标背景层（icon.png 青绿渐变）==')
    for dens, canvas in FOREGROUND:
        bg = grad_master.resize((canvas, canvas), Image.LANCZOS)
        save(bg, os.path.join(RES, f'mipmap-{dens}', 'ic_launcher_bg.png'))

    print('== 自适应图标前景层（icon.png 白色守宫，质心居中）==')
    for dens, canvas in FOREGROUND:
        # 守宫内容缩到安全区（108dp 画布内 66dp ≈ 61%）内
        safe = canvas * 0.60
        scale = safe / max(lw, lh)
        nw, nh = max(1, int(lw * scale)), max(1, int(lh * scale))
        art = Image.new('RGBA', (nw, nh), (255, 255, 255, 0))
        art.putalpha(wmask.resize((nw, nh), Image.LANCZOS))
        # 前景层为白色守宫（RGB 全白，alpha 取遮罩）
        art = Image.merge('RGBA', (
            Image.new('L', (nw, nh), 255),
            Image.new('L', (nw, nh), 255),
            Image.new('L', (nw, nh), 255),
            art.getchannel('A'),
        ))
        fg = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        # v3.6：按质心对齐画布中心 —— 先算出质心落点，再反推左上角偏移
        ox = int(round(canvas / 2.0 - rcx_global * nw))
        oy = int(round(canvas / 2.0 - rcy_global * nh))
        fg.paste(art, (ox, oy), art)
        save(fg, os.path.join(RES, f'mipmap-{dens}', 'ic_launcher_foreground.png'))

    print('== legacy 方形 / 圆形图标（渐变 + 居中守宫 + 原圆角轮廓）==')
    for dens, size in DENSITIES:
        sq = compose_centered(grad_master, lizard, shape_alpha, size)
        save(sq, os.path.join(RES, f'mipmap-{dens}', 'ic_launcher.png'))
        rd = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        rd.paste(sq, (0, 0), sq)
        rd.putalpha(Image.composite(rd.getchannel('A'), Image.new('L', (size, size), 0), circle_mask(size)))
        save(rd, os.path.join(RES, f'mipmap-{dens}', 'ic_launcher_round.png'))

    print('== 启动页 logo（源 logo-g.png）==')
    logo = Image.open(LOGO_SRC).convert('RGBA')
    lb = logo.getbbox()
    logo = logo.crop(lb)
    logo.thumbnail((256, 256), Image.LANCZOS)
    save(logo, os.path.join(RES, 'drawable-nodpi', 'splash_logo.png'))

    print('== Web 图标 ==')
    for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-180.png')]:
        save(compose_centered(grad_master, lizard, shape_alpha, size), os.path.join(ICONS, name))
    lg = Image.open(LOGO_SRC).convert('RGBA')
    lg = lg.crop(lg.getbbox())
    # v3.5：Web 端 logo-g 提到 512px —— 更新弹窗按 88px 显示，
    # 在 3x 高密度屏上实际需要 264 物理像素，96px 源图会发虚。
    lg.thumbnail((512, 512), Image.LANCZOS)
    save(lg, os.path.join(ICONS, 'logo-g.png'))

    print('== exe 图标（icon.ico，多尺寸）==')
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [compose_centered(grad_master, lizard, shape_alpha, s) for s in ico_sizes]
    ico_path = os.path.join(ROOT, 'icon.ico')
    frames[-1].save(ico_path, 'ICO', sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])
    print('  OK icon.ico', ico_sizes, f'{os.path.getsize(ico_path) // 1024}KB')

    # 预览图（供人工目视核对居中效果，输出到 .tmp/icon-preview/）
    prev_dir = os.path.join(ROOT, '.tmp', 'icon-preview')
    os.makedirs(prev_dir, exist_ok=True)
    # legacy 方形
    compose_centered(grad_master, lizard, shape_alpha, 256).save(os.path.join(prev_dir, 'legacy-square.png'))
    # legacy 圆形
    cs = compose_centered(grad_master, lizard, shape_alpha, 256)
    circ = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    circ.paste(cs, (0, 0), cs)
    circ.putalpha(Image.composite(circ.getchannel('A'), Image.new('L', (256, 256), 0), circle_mask(256)))
    circ.save(os.path.join(prev_dir, 'legacy-round.png'))
    # 自适应图标（模拟圆形遮罩，可见区为 108dp 画布中心 72dp）
    canvas = 432
    bg = grad_master.resize((canvas, canvas), Image.LANCZOS).convert('RGBA')
    safe = canvas * 0.60
    sc = safe / max(lw, lh)
    nw, nh = int(lw * sc), int(lh * sc)
    art = Image.new('RGBA', (nw, nh), (255, 255, 255, 0))
    art.putalpha(wmask.resize((nw, nh), Image.LANCZOS))
    art = Image.merge('RGBA', (Image.new('L', (nw, nh), 255), Image.new('L', (nw, nh), 255),
                           Image.new('L', (nw, nh), 255), art.getchannel('A')))
    fg = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    fg.paste(art, (int(round(canvas / 2.0 - rcx_global * nw)), int(round(canvas / 2.0 - rcy_global * nh))), art)
    comp = bg.copy()
    comp.paste(fg, (0, 0), fg)
    inset = canvas * 18 // 108
    maskc = Image.new('L', (canvas, canvas), 0)
    ImageDraw.Draw(maskc).ellipse((inset, inset, canvas - inset, canvas - inset), fill=255)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    out.paste(comp, (0, 0), maskc)
    out.resize((256, 256), Image.LANCZOS).save(os.path.join(prev_dir, 'adaptive-circle.png'))
    print('  预览已输出到 .tmp/icon-preview/')

    print('\n图标生成完成。')


if __name__ == '__main__':
    main()
