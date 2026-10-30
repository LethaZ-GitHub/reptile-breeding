// lightbox.js —— 全局图片 / SVG 全屏查看器：双击或双指缩放、拖拽平移、点击背景关闭
'use strict';

/* ---------------- 查看器本体 ---------------- */
let viewerEl = null;
let viewerState = null;

function ensureViewer() {
  if (viewerEl) return viewerEl;
  const root = document.createElement('div');
  root.className = 'zoom-viewer';
  root.innerHTML = `
    <div class="zv-head">
      <span class="zv-title"></span>
      <button class="zv-close" title="关闭">✕</button>
    </div>
    <div class="zv-stage">
      <div class="zv-box">
        <div class="zv-content"></div>
      </div>
    </div>
    <div class="zv-tip">双击 / 双指缩放 · 拖拽平移 · 点击空白处关闭</div>`;
  document.body.appendChild(root);
  viewerEl = root;
  return root;
}

function closeViewer() {
  if (!viewerEl) return;
  viewerEl.classList.remove('open');
  const c = viewerEl.querySelector('.zv-content');
  if (c) c.innerHTML = '';
  viewerState = null;
  document.body.style.overflow = '';
}

/* 指针交互：单指拖拽平移、双指捏合缩放、双击切换 1x/2.5x */
function bindGestures(stage, box) {
  const st = { scale: 1, x: 0, y: 0, min: 0.5, max: 4 };
  const pointers = new Map();
  let lastDist = 0, lastTap = 0, moved = 0;

  const apply = () => {
    box.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.scale})`;
  };
  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  stage.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    stage.setPointerCapture(e.pointerId);
    if (pointers.size === 2) lastDist = dist();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const d = dist();
      if (lastDist > 0) {
        const next = Math.min(st.max, Math.max(st.min, (st.scale * d) / lastDist));
        st.scale = next;
      }
      lastDist = d;
      apply();
    } else if (pointers.size === 1 && st.scale > 1) {
      st.x += e.clientX - prev.x;
      st.y += e.clientY - prev.y;
      apply();
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastDist = 0;
    // 双击缩放
    const now = Date.now();
    if (moved < 6 && pointers.size === 0 && now - lastTap < 280) {
      st.scale = st.scale > 1 ? 1 : 2.5;
      st.x = 0; st.y = 0;
      apply();
      lastTap = 0;
    } else if (moved < 6) lastTap = now;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); lastDist = 0; });
  // 滚轮缩放（桌面）
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    st.scale = Math.min(st.max, Math.max(st.min, st.scale * (e.deltaY < 0 ? 1.15 : 0.87)));
    apply();
  }, { passive: false });
  // 点击空白处关闭（点在内容上且未放大时不关，便于查看）
  stage.addEventListener('click', (e) => {
    if (e.target === stage || e.target.classList.contains('zv-box')) closeViewer();
  });
  return st;
}

/**
 * 打开查看器
 * @param {'img'|'svg'} type
 * @param {string|SVGElement} source  img: src；svg: SVG 元素（克隆后展示）
 * @param {string} title
 */
export function openZoomViewer(type, source, title = '') {
  const root = ensureViewer();
  const content = root.querySelector('.zv-content');
  content.innerHTML = '';
  let fitFn = null;
  if (type === 'svg' && source) {
    const clone = source.cloneNode(true);
    clone.removeAttribute('class');
    // v2.7：克隆可能带上源节点的行内宽高（谱系弹窗会按容器设置 inline width），
    //      不清掉会覆盖下面按 viewBox 算出的属性，导致放大后尺寸不符预期
    clone.style.removeProperty('width');
    clone.style.removeProperty('height');
    // v2.6：无宽高属性的 SVG 在嵌套 flex（.zv-stage > .zv-content > .zv-box）中会塌缩为 0 尺寸，
    //      导致「点击放大不显示」——按 viewBox 显式算出像素宽高再放入查看器
    // v2.7：改为按舞台实际尺寸「包含」缩放——先按视口估算，display 生效后再校准
    //      （WebView 的 window.innerHeight 可能含/不含系统 UI，直接用会算出偏大尺寸被裁切）
    const vb = (clone.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      const fit = () => {
        const stage = root.querySelector('.zv-stage');
        const sw = Math.max(200, (stage ? stage.clientWidth : window.innerWidth || 360) - 16);
        const sh = Math.max(160, (stage ? stage.clientHeight : window.innerHeight || 640) - 150);
        const ratio = Math.min(sw / vb[2], sh / vb[3], 2);
        clone.setAttribute('width', String(Math.round(vb[2] * ratio)));
        clone.setAttribute('height', String(Math.round(vb[3] * ratio)));
      };
      fitFn = fit;
      fit();
    }
    clone.style.maxWidth = '100%';
    clone.style.height = 'auto';
    clone.style.display = 'block';
    clone.style.touchAction = 'none';
    content.appendChild(clone);
  } else if (source) {
    const img = document.createElement('img');
    img.src = source;
    img.alt = title || '图片';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.display = 'block';
    img.style.touchAction = 'none';
    img.draggable = false;
    content.appendChild(img);
  }
  root.querySelector('.zv-title').textContent = title || '';
  root.classList.add('open');
  document.body.style.overflow = 'hidden';
  root.querySelector('.zv-close').onclick = closeViewer;
  const stage = root.querySelector('.zv-stage');
  const box = root.querySelector('.zv-box');
  box.style.transform = 'translate(0px, 0px) scale(1)';
  viewerState = bindGestures(stage, box);
  // 部分 WebView 首次渲染时盒子尺寸为 0，下一帧再校准一次
  requestAnimationFrame(() => { box.style.transform = 'translate(0px, 0px) scale(1)'; });
  if (fitFn) { fitFn(); requestAnimationFrame(fitFn); }
  return { close: closeViewer };
}

export const openImageViewer = (src, title) => openZoomViewer('img', src, title);
export const openSvgViewer = (svgEl, title) => openZoomViewer('svg', svgEl, title);
export const closeZoomViewer = closeViewer;

/* ---------------- 全局图片点击委托 ---------------- */
// 页面内任意 <img>（按钮内、.no-zoom 容器内的除外）点击后全屏查看
export function installLightbox() {
  if (window.__rbLightboxInstalled) return;
  window.__rbLightboxInstalled = true;
  document.addEventListener('click', (e) => {
    const img = e.target && e.target.closest ? e.target.closest('img') : null;
    if (!img) return;
    if (img.closest('button') || img.closest('a') || img.closest('.no-zoom') || img.closest('.zoom-viewer')) return;
    if (!img.src) return;
    e.preventDefault();
    openImageViewer(img.currentSrc || img.src, img.alt || '');
  }, true);
  // Esc 关闭（桌面）
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });
}
