// util.js —— 通用工具：UUID / 日期 / HTML转义 / 弹窗 / Toast / 下载 / 分页
'use strict';

/* ---------- UUID ---------- */
export function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---------- 日期 ---------- */
const p2 = (n) => String(n).padStart(2, '0');
export function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function nowIso() { return new Date().toISOString(); }
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export function dateStr(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export function monthKey(d) { // 'YYYY-MM'
  d = d || new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
}
export function addDays(dateStr0, n) {
  const d = new Date(dateStr0 + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
export function daysBetween(a, b) { // b - a，按天
  const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}
export function fmtDate(s) { return s ? s.slice(0, 10) : ''; }
export function monthLabel(key) { // '2026-10' -> '2026年10月'
  const [y, m] = key.split('-');
  return `${y}年${+m}月`;
}
export function prevMonth(key) {
  let [y, m] = key.split('-').map(Number);
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  return `${y}-${p2(m)}`;
}
export function nextMonth(key) {
  let [y, m] = key.split('-').map(Number);
  m += 1; if (m > 12) { m = 1; y += 1; }
  return `${y}-${p2(m)}`;
}

/* ---------- HTML ---------- */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------- Toast ---------- */
export function toast(msg, type = '', ms = 2200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}

/* ---------- 弹窗（confirm / prompt / 自定义） ---------- */
function openModal({ title, bodyHtml, buttons }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal" role="dialog">
        <div class="m-head"><div class="m-title">${esc(title)}</div>
          <button class="m-close" title="关闭">✕</button></div>
        <div class="m-body">${bodyHtml}</div>
        <div class="m-foot"></div>
      </div>`;
    const foot = mask.querySelector('.m-foot');
    // 延迟一帧移除：调用方 await 返回后（微任务）仍能读取输入框的值
    const close = (val) => { setTimeout(() => mask.remove(), 0); resolve(val); };
    mask.querySelector('.m-close').onclick = () => close(null);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(null); });
    (buttons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.text;
      btn.onclick = () => close(b.value !== undefined ? b.value : b.text);
      foot.appendChild(btn);
    });
    root.appendChild(mask);
  });
}
export function confirmDialog(title, message, { okText = '确定', danger = false } = {}) {
  return openModal({
    title,
    bodyHtml: `<div style="line-height:1.7;font-size:13.5px;white-space:pre-line">${esc(message)}</div>`,
    buttons: [
      { text: '取消', cls: 'ghost', value: false },
      { text: okText, cls: danger ? 'danger' : '', value: true },
    ],
  }).then((v) => v === true);
}
export function promptDialog(title, message, { defaultValue = '', placeholder = '', okText = '确定' } = {}) {
  return openModal({
    title,
    bodyHtml: `<div style="font-size:13.5px;margin-bottom:8px;line-height:1.6">${esc(message)}</div>
      <input type="text" id="_pd-input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);outline:none">`,
    buttons: [
      { text: '取消', cls: 'ghost', value: null },
      { text: okText, value: '__ok__' },
    ],
  }).then((v) => {
    if (v === null) return null;                 // 取消 → null（调用方必须提前 return）
    const input = document.getElementById('_pd-input');
    const val = (input.value || '').trim();
    if (!val) { toast('内容不能为空', 'warn'); return null; }
    return val;
  });
}
export function customModal({ title, bodyHtml, buttons, onOpen }) {
  return openModal({ title, bodyHtml, buttons: buttons || [{ text: '关闭', cls: 'ghost', value: false }] })
    .then(() => { if (onOpen) onOpen(); });
}
export function runModal({ title, bodyHtml, buttons, mount }) {
  // mount(maskEl, close) 可绑定自定义交互；buttons 的 value 会 resolve
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal" role="dialog">
        <div class="m-head"><div class="m-title">${esc(title)}</div>
          <button class="m-close" title="关闭">✕</button></div>
        <div class="m-body">${bodyHtml}</div>
        <div class="m-foot"></div>
      </div>`;
    const foot = mask.querySelector('.m-foot');
    const close = (val) => { setTimeout(() => mask.remove(), 0); resolve(val); };
    mask.querySelector('.m-close').onclick = () => close(null);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(null); });
    (buttons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.text;
      btn.onclick = () => close(b.value !== undefined ? b.value : b.text);
      foot.appendChild(btn);
    });
    root.appendChild(mask);
    if (mount) mount(mask, close);
  });
}

/* ---------- 下载文件 ---------- */
// data: URL → Blob（canvas.toDataURL 的产物若直接塞进 Blob，存下来的会是一段文本而非二进制）
function dataUrlToBlob(dataUrl, fallbackMime) {
  const [head, body = ''] = String(dataUrl).split(',');
  const mime = (head.match(/data:([^;,]+)/) || [])[1] || fallbackMime || 'application/octet-stream';
  let bytes;
  if (/;base64/i.test(head)) {
    const bin = atob(body);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(body));
  }
  return new Blob([bytes], { type: mime });
}
// 字节数组 → base64（供原生 saveFile 桥使用）
function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
export function download(filename, content, mime = 'application/json') {
  // ① 原生 App（Android WebView 对 a[download] 支持不稳）：走 RBNative.saveFile 写系统下载目录
  if (typeof window !== 'undefined' && window.RBNative && typeof window.RBNative.saveFile === 'function') {
    try {
      if (typeof content === 'string') {
        const base64 = content.startsWith('data:')
          ? content.slice(content.indexOf(',') + 1)
          : bytesToBase64(new TextEncoder().encode(content));
        window.RBNative.saveFile(filename, base64, mime);
        toast('已保存到系统下载目录：' + filename);
        return;
      }
      if (content instanceof Blob) {
        content.arrayBuffer().then((buf) => {
          window.RBNative.saveFile(filename, bytesToBase64(new Uint8Array(buf)), content.type || mime);
          toast('已保存到系统下载目录：' + filename);
        });
        return;
      }
    } catch (e) { /* 原生桥异常时回退 Web 下载 */ }
  }
  // ② Web / 桌面：blob URL + a[download]
  const blob = content instanceof Blob ? content
    : (typeof content === 'string' && content.startsWith('data:') ? dataUrlToBlob(content, mime)
      : new Blob([content], { type: mime }));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 800);
}
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

/* ---------- 简单分页 ---------- */
// pageInfo(page, total, size) -> {start, end, pages, page}
export function pageInfo(page, total, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  return { pages, page: p, start: (p - 1) * size, end: Math.min(total, p * size) };
}
// 渲染分页条到 el；onChange(newPage)
export function pagerHtml(page, total, size) {
  const { pages, page: p, start, end } = pageInfo(page, total, size);
  if (total === 0) return '';
  return `<div class="pager" data-page="${p}" data-pages="${pages}">
    <button data-act="prev" ${p <= 1 ? 'disabled' : ''}>‹ 上一页</button>
    <span>${start + 1}-${end} / 共 ${total} 条</span>
    <button data-act="next" ${p >= pages ? 'disabled' : ''}>下一页 ›</button>
  </div>`;
}
export function bindPager(el, onChange) {
  if (!el) return;
  const bar = el.querySelector('.pager');
  if (!bar) return;
  bar.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const cur = +bar.dataset.page;
      onChange(b.dataset.act === 'prev' ? cur - 1 : cur + 1);
    };
  });
}

/* ---------- 其他 ---------- */
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
export function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
