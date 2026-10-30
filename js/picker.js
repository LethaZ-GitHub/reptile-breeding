// picker.js —— 自定义下拉选择器
// 原生 <select> 保留在 DOM 中（视觉隐藏、语义保留），页面逻辑读写 .value / onchange 完全不变；
// 视觉层替换为样式化触发器 + 选项弹层。
// 背景：WebView 下原生 select 弹层丑陋且不可样式化；早期用 appearance:none + 背景箭头图的方案
// 会被 `.field select { background: var(--card) }` 简写把 background-image 重置为 none，导致箭头丢失。
'use strict';

import { esc, runModal } from './util.js';

// 需要随包裹层保留的布局属性（视觉属性交给触发器 CSS）
const LAYOUT_PROPS = ['width', 'minWidth', 'maxWidth', 'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'textAlign'];

const CARET = '<svg class="pk-caret" viewBox="0 0 12 8" width="11" height="7" aria-hidden="true">'
  + '<path d="M1 1.2L6 6.4 11 1.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function triggerOf(sel) {
  const wrap = sel.parentNode;
  return (wrap && wrap.classList && wrap.classList.contains('pk-wrap')) ? wrap.querySelector('.pk-btn') : null;
}

export function syncPickerLabel(sel) {
  const btn = triggerOf(sel);
  if (!btn) return;
  const lab = btn.querySelector('.pk-label');
  if (sel.multiple) {
    // 多选：显示已选数量与名称（超出省略）
    // v3.6：名称列表过长时（如基因预测页选了 6 个基因）只保留前若干个，
    //   末尾加「等 N 项」——否则整段文字会把触发器撑到几百 px 宽。
    const picked = [...sel.selectedOptions];
    if (!picked.length) {
      lab.textContent = sel.dataset.pkEmptyText || '请选择（可不选）';
      btn.classList.add('pk-empty');
    } else {
      const names = picked.map((o) => o.textContent);
      const MAX_NAMES = 2;
      let text;
      if (names.length === 1) text = names[0];
      else if (names.length <= MAX_NAMES) text = `已选 ${names.length} 项：${names.join('、')}`;
      else text = `已选 ${names.length} 项：${names.slice(0, MAX_NAMES).join('、')} 等`;
      lab.textContent = text;
      btn.classList.remove('pk-empty');
    }
    btn.disabled = !!sel.disabled;
    btn.title = [...sel.selectedOptions].map((o) => o.textContent).join('、') || lab.textContent;
    return;
  }
  const opt = sel.options[sel.selectedIndex];
  lab.textContent = (opt && opt.textContent) || '请选择';
  btn.classList.toggle('pk-empty', !sel.value);
  btn.disabled = !!sel.disabled;
  btn.title = lab.textContent;
}

function openSheet(sel) {
  if (sel.disabled) return;
  const opts = [...sel.options];
  if (!opts.length) return;
  const needSearch = opts.length > 8;
  const rows = opts.map((o, i) => `
    <div class="pk-opt${o.selected ? ' on' : ''}${o.disabled ? ' dis' : ''}" data-i="${i}" role="option" aria-selected="${o.selected ? 'true' : 'false'}">
      <span class="pk-opt-txt">${esc(o.textContent)}</span>${o.selected ? '<span class="pk-check">✓</span>' : ''}
    </div>`).join('');
  runModal({
    title: '请选择',
    bodyHtml: `${needSearch ? '<input type="text" id="pk-q" class="pk-q" placeholder="搜索选项…">' : ''}<div class="pk-list" id="pk-list">${rows}</div>`,
    buttons: [],
    mount(mask, close) {
      const list = mask.querySelector('#pk-list');
      const q = mask.querySelector('#pk-q');
      if (q) {
        q.oninput = () => {
          const kw = q.value.trim().toLowerCase();
          list.querySelectorAll('.pk-opt').forEach((row) => {
            const t = row.querySelector('.pk-opt-txt').textContent.toLowerCase();
            row.style.display = (!kw || t.includes(kw)) ? '' : 'none';
          });
        };
        setTimeout(() => q.focus(), 50);
      }
      list.querySelectorAll('.pk-opt').forEach((row) => {
        row.onclick = () => {
          const o = opts[+row.dataset.i];
          if (!o || o.disabled) return;
          sel.value = o.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          syncPickerLabel(sel);
          close(null);
        };
      });
      const on = list.querySelector('.pk-opt.on');
      if (on) setTimeout(() => { try { on.scrollIntoView({ block: 'center' }); } catch (e) { /* 老 WebView */ } }, 50);
    },
  });
}

/* ---------- 多选（select[multiple]） ----------
   v3.1：食物库的「适用物种」需要可空可多选。
   原生多选框在 WebView 下几乎不可用，这里自研弹层：勾选态暂存于本地集合，
   点「确定」才写回原生 select 并派发 change；「清空」可一键置空（= 通用）。
   v3.5：弹层内支持「类别筛选」——select 上以 data-pk-filters 声明筛选项，
   例如 data-pk-filters='[{"key":"type","v":"","l":"全部"},{"key":"type","v":"recessive","l":"隐性"}]'，
   选项上用 data-type="recessive" 标注归属，筛选 chips 置于搜索框与列表之间。 */
function openMultiSheet(sel) {
  if (sel.disabled) return;
  const opts = [...sel.options];
  if (!opts.length) return;
  const picked = new Set([...sel.selectedOptions].map((o) => o.value));
  const needSearch = opts.length > 8;
  // v3.5：类别筛选定义（可为空）
  let filters = [];
  try {
    const raw = sel.dataset.pkFilters;
    if (raw) filters = JSON.parse(raw) || [];
  } catch (e) { filters = []; }
  const filterKey = filters.length ? (filters[0].key || 'type') : 'type';
  let activeFilter = '';
  let kw = '';
  const rowHtml = () => opts.map((o, i) => `
    <div class="pk-opt${picked.has(o.value) ? ' on' : ''}${o.disabled ? ' dis' : ''}" data-i="${i}" data-f="${esc(o.dataset[filterKey] || '')}" role="option" aria-selected="${picked.has(o.value) ? 'true' : 'false'}">
      <span class="pk-check pk-box">${picked.has(o.value) ? '✓' : ''}</span>
      <span class="pk-opt-txt">${esc(o.textContent)}</span>
    </div>`).join('');
  const filterHtml = filters.length ? `
    <div class="pk-filters" id="pk-filters">
      ${filters.map((f, i) => `<div class="pk-chip${i === 0 ? ' active' : ''}" data-fv="${esc(f.v)}">${esc(f.l)}</div>`).join('')}
    </div>` : '';

  runModal({
    title: sel.dataset.pkTitle || '选择（可多选）',
    bodyHtml: `${needSearch ? '<input type="text" id="pk-q" class="pk-q" placeholder="搜索选项…">' : ''}
      ${filterHtml}
      <div class="pk-list" id="pk-list">${rowHtml()}</div>
      <div class="pk-multi-foot">
        <button type="button" class="btn ghost sm" id="pk-clear">清空</button>
        <button type="button" class="btn sm" id="pk-ok">确定</button>
      </div>`,
    buttons: [],
    mount(mask, close) {
      const list = mask.querySelector('#pk-list');
      const q = mask.querySelector('#pk-q');
      const applyFilter = () => {
        list.querySelectorAll('.pk-opt').forEach((row) => {
          const t = row.querySelector('.pk-opt-txt').textContent.toLowerCase();
          const okKw = !kw || t.includes(kw);
          const okF = !activeFilter || row.dataset.f === activeFilter;
          row.style.display = (okKw && okF) ? '' : 'none';
        });
      };
      const redraw = () => {
        list.innerHTML = rowHtml();
        list.querySelectorAll('.pk-opt').forEach((row) => {
          row.onclick = () => {
            const o = opts[+row.dataset.i];
            if (!o || o.disabled) return;
            if (picked.has(o.value)) picked.delete(o.value);
            else picked.add(o.value);
            redraw();
          };
        });
        applyFilter();
      };
      if (q) {
        q.oninput = () => {
          kw = q.value.trim().toLowerCase();
          applyFilter();
        };
        setTimeout(() => q.focus(), 50);
      }
      const chipWrap = mask.querySelector('#pk-filters');
      if (chipWrap) {
        chipWrap.querySelectorAll('.pk-chip').forEach((chip) => {
          chip.onclick = () => {
            activeFilter = chip.dataset.fv || '';
            chipWrap.querySelectorAll('.pk-chip').forEach((c) => c.classList.toggle('active', c === chip));
            applyFilter();
          };
        });
      }
      redraw();
      mask.querySelector('#pk-clear').onclick = () => { picked.clear(); redraw(); };
      mask.querySelector('#pk-ok').onclick = () => {
        opts.forEach((o) => { o.selected = picked.has(o.value); });
        syncPickerLabel(sel);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        close(null);
      };
    },
  });
}

export function enhanceSelect(sel) {
  if (!sel || sel.tagName !== 'SELECT' || sel.dataset.pkDone) { if (sel) syncPickerLabel(sel); return; }
  sel.dataset.pkDone = '1';
  // 1) 包裹层承接布局上下文（flex / 宽度 / 边距）
  const wrap = document.createElement('span');
  wrap.className = 'pk-wrap';
  const cs = sel.style;
  LAYOUT_PROPS.forEach((p) => { if (cs[p]) wrap.style[p] = cs[p]; });
  sel.parentNode.insertBefore(wrap, sel);
  // 2) 触发器 + 保留原生 select
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pk-btn';
  btn.innerHTML = '<span class="pk-label"></span>' + CARET;
  btn.onclick = () => (sel.multiple ? openMultiSheet(sel) : openSheet(sel));
  wrap.appendChild(btn);
  wrap.appendChild(sel);
  sel.classList.add('pk-native');
  sel.removeAttribute('style');
  // v3.5：监听 change，任何来源（弹层确定 / 代码设置 selected）都同步触发器标签
  sel.addEventListener('change', () => syncPickerLabel(sel));
  syncPickerLabel(sel);
}

function scan(root) {
  if (!root) return;
  if (root.nodeType !== 1) return;
  if (root.tagName === 'SELECT') { enhanceSelect(root); return; }
  if (root.querySelectorAll) root.querySelectorAll('select').forEach(enhanceSelect);
}

let installed = false;
// 全局安装：MutationObserver 自动增强动态渲染出的 select，并同步选项变化后的标签
export function installPicker() {
  if (installed) return;
  installed = true;
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) scan(n);
      if (m.target && m.target.tagName === 'SELECT') syncPickerLabel(m.target);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  scan(document.body);
}
export function enhanceSelects(root) { scan(root || document.body); }
