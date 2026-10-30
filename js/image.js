// image.js —— 照片压缩（Canvas）：生成展示图(≤1440px) + 缩略图(≤360px)
// 约束：单只最多 3 张；上传无大小上限但自动压缩，保证不过度模糊。
'use strict';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败，可能是不支持的格式'));
    img.src = URL.createObjectURL(file);
  });
}

function drawTo(img, maxEdge, quality) {
  let { width: w, height: h } = img;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', quality);
}

function dataUrlSize(dataUrl) {
  const i = dataUrl.indexOf(',');
  return Math.ceil((dataUrl.length - i - 1) * 3 / 4);
}

// 逐级降质直到低于预算，最低 0.62 画质（观感仍清晰，不会过度模糊）
function compressUnder(img, maxEdge, budget) {
  let q = 0.85, out = drawTo(img, maxEdge, q);
  while (dataUrlSize(out) > budget && q > 0.62) {
    q -= 0.08;
    out = drawTo(img, maxEdge, Math.max(0.62, q));
  }
  return out;
}

// file(File) -> { full, thumb }
export async function compressPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const img = await loadImage(file);
  const full = compressUnder(img, 1440, 700 * 1024);      // 展示图 ≤ ~700KB
  const thumb = compressUnder(img, 360, 60 * 1024);        // 缩略图 ≤ ~60KB
  return { full, thumb };
}
