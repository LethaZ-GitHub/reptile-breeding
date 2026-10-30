// charts.js —— 纯 SVG 图表：折线（趋势）、环形（饼图），支持导出 PNG
// 注意：导出 PNG 时 SVG 被序列化后绘制，所有颜色/字体必须内联，不能依赖外部 CSS。
'use strict';

import { download, toast } from './util.js';

const INK = '#333333';
const FONT = '"PingFang SC","Microsoft YaHei",sans-serif';

function escSvg(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 折线图 ---------- */
export function lineChart({ points, color = '#2e9e6b', unit = '', width = 680, height = 220, yminPad = true }) {
  // points: [{x: 'MM-DD', y: 12.3}]
  if (!points || points.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#999" font-size="13" font-family="${FONT}">暂无数据</text></svg>`;
  }
  const padL = 44, padR = 14, padT = 14, padB = 26;
  const iw = width - padL - padR, ih = height - padT - padB;
  const ys = points.map((p) => Number(p.y)).filter((v) => !isNaN(v));
  if (!ys.length) return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#999" font-size="13">暂无有效数值</text></svg>`;
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yminPad) { yMin = yMin - (yMax - yMin || yMax * 0.1 || 1) * 0.15; if (yMin < 0) yMin = 0; }
  if (yMax === yMin) { yMax = yMin + 1; }
  const n = points.length;
  const X = (i) => padL + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const Y = (v) => padT + ih - ((v - yMin) / (yMax - yMin)) * ih;

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = yMin + ((yMax - yMin) * g) / 4;
    const yy = Y(v);
    grid += `<line x1="${padL}" y1="${yy}" x2="${width - padR}" y2="${yy}" stroke="#e6e6e6" stroke-width="1"/>
      <text x="${padL - 6}" y="${yy + 4}" text-anchor="end" fill="#999" font-size="10" font-family="${FONT}">${Math.round(v * 10) / 10}</text>`;
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${path} L${X(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${X(0).toFixed(1)},${(padT + ih).toFixed(1)} Z`;
  const dots = points.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="#fff" stroke="${color}" stroke-width="2"><title>${escSvg(p.x)}: ${p.y}${escSvg(unit)}</title></circle>`).join('');
  // x 轴标签（最多 6 个）
  const step = Math.max(1, Math.ceil(n / 6));
  let xlab = '';
  points.forEach((p, i) => {
    if (i % step === 0 || i === n - 1) {
      xlab += `<text x="${X(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="#999" font-size="10" font-family="${FONT}">${escSvg(p.x)}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="lg-${color.replace('#', '')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#lg-${color.replace('#', '')})"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xlab}
  </svg>`;
}

/* ---------- 环形图 ---------- */
export function donutChart({ data, size = 220, thickness = 30 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 4;
  const rr = r - thickness;
  const cx = size / 2, cy = size / 2;
  if (!total) {
    return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${cx}" cy="${cy}" r="${r - thickness / 2}" fill="none" stroke="#e6e6e6" stroke-width="${thickness}"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#999" font-size="12" font-family="${FONT}">无数据</text></svg>`;
  }
  let angle = -Math.PI / 2;
  let arcs = '';
  data.forEach((d) => {
    const frac = d.value / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const x3 = cx + rr * Math.cos(a2), y3 = cy + rr * Math.sin(a2);
    const x4 = cx + rr * Math.cos(angle), y4 = cy + rr * Math.sin(angle);
    arcs += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${rr},${rr} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z" fill="${d.color}"><title>${escSvg(d.label)}: ${d.value}</title></path>`;
    angle = a2;
  });
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="${INK}" font-size="15" font-weight="700" font-family="${FONT}">¥${total.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#999" font-size="10" font-family="${FONT}">合计</text>
  </svg>`;
}

/* ---------- SVG → PNG 导出（安卓 WebView 加固版） ----------
   老 WebView 的三个坑：① SVG 根没有显式 width/height 时 <img> 可能不触发 onload；
   ② 超长 data: URL 加载失败；③ SVG 图片污染画布时 toDataURL 抛错。
   策略：data URL → Blob URL → 直接存 .svg 文件，层层回退，任何一环失败用户都能拿到图。 */
export function svgToPng(svgEl, filename, { bg = '#ffffff', scale = 2 } = {}) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  const vb = (clone.getAttribute('viewBox') || '0 0 680 300').split(/\s+/).map(Number);
  const W = vb[2] || 680, H = vb[3] || 300;
  if (!clone.getAttribute('width')) clone.setAttribute('width', W);
  if (!clone.getAttribute('height')) clone.setAttribute('height', H);
  const svgStr = new XMLSerializer().serializeToString(clone);
  const svgName = filename.replace(/\.png$/i, '') + '.svg';
  let finished = false;

  const saveSvg = () => {
    if (finished) return;
    finished = true;
    download(svgName, svgStr, 'image/svg+xml');
    toast('PNG 生成失败，已保存为 SVG 图片（可在相册 / 浏览器中查看）', 'warn');
  };

  const render = (url, isBlob) => {
    const img = new Image();
    // 兜底超时：某些 WebView 既不触发 onload 也不触发 onerror
    const timer = setTimeout(() => {
      img.onload = null; img.onerror = null;
      if (isBlob) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
      saveSvg();
    }, 8000);
    img.onload = () => {
      clearTimeout(timer);
      let out = '';
      try {
        const cv = document.createElement('canvas');
        cv.width = W * scale; cv.height = H * scale;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        out = cv.toDataURL('image/png');
      } catch (e) { out = ''; }
      if (isBlob) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
      if (finished) return;
      if (!out || out.length < 64) { saveSvg(); return; }
      finished = true;
      download(filename, out, 'image/png');
      toast('已导出 ' + filename, 'ok');
    };
    img.onerror = () => {
      clearTimeout(timer);
      if (isBlob) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
      if (finished) return;
      if (!isBlob) {
        // data URL 失败 → 换 Blob URL 再试（绕开超长 data URL 限制）
        try {
          const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
          render(URL.createObjectURL(blob), true);
          return;
        } catch (e) { /* 继续降级 */ }
      }
      saveSvg();
    };
    img.src = url;
  };

  render('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr), false);
}
