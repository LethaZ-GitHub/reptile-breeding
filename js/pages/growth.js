// pages/growth.js —— 成长记录：按爬柜/物种筛选 → 选个体 → 录体重体长 → 看曲线；
//                   右上角「历史记录」弹窗：爬柜/物种/基因筛选 → 选个体 → 历史体重体长增删查改
'use strict';

import { esc, toast, todayStr, nowStr, runModal, confirmDialog } from '../util.js';
import { pageHead, emptyTip, animalThumbHtml, sexIco } from '../ui.js';
import { lineChart } from '../charts.js';
import {
  listAnimals, listPlans, listCages, listSpecies, listGenes, listLogs, addLog, updateLog, removeLog,
  storeWeight, storeLength, dispWeight, dispLength,
} from '../store.js';
import { unitWeight, unitLength } from '../settings.js';

const state = { planId: '', speciesId: '', selectedId: '', page: 1, anim: '' };

/* v3.1：选择个体分页 —— 每页默认 4 个，手机端可在网格上左右滑动翻页 */
const PAGE_SIZE = 4;
/* v3.2：滑动翻页阈值（px）—— 与视口宽度取较大者，避免大屏上轻扫就翻页 */
const SWIPE_MIN = 60;

/* ---------- 个体选择网格（分页 + 滑动翻页） ----------
   返回 { html, pagerHtml } —— 调用方负责绑定按钮与滑动手势。 */
function animalGridHtml(list, page, pickedId, opts = {}) {
  const size = opts.size || PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page || 1), pages);
  const start = (p - 1) * size;
  const rows = list.slice(start, start + size);
  const cells = rows.map((a) => `
    <div class="growth-cell ${a.id === pickedId ? 'picked' : ''}" data-id="${a.id}">
      ${animalThumbHtml(a)}
      <div class="gc-name">${esc(a.name)} ${sexIco(a.sex)}</div>
      <div class="gc-sub">${esc(a.code || '')}</div>
      ${opts.showWeight ? `<div class="gc-sub">${a.weight != null ? `${dispWeight(a.weight)}${unitWeight()}` : '未测'}</div>` : ''}
    </div>`).join('');
  const pager = list.length > size ? `
    <div class="growth-pager">
      <button class="gp-btn" data-gp="prev" ${p <= 1 ? 'disabled' : ''} aria-label="上一页">‹</button>
      <span class="gp-info">第 ${p} / ${pages} 页 · 共 ${list.length} 只</span>
      <button class="gp-btn" data-gp="next" ${p >= pages ? 'disabled' : ''} aria-label="下一页">›</button>
    </div>
    <div class="hint" style="text-align:center;margin-top:2px">手机端可在网格上左右滑动翻页</div>` : '';
  /* v3.2：anim 控制翻页后新页面的滑入动画（anim-in-next / anim-in-prev） */
  const animCls = opts.anim ? ` ${opts.anim}` : '';
  return {
    html: rows.length ? `<div class="growth-viewport"><div class="growth-grid${animCls}" id="${opts.gridId || 'g-grid'}">${cells}</div></div>${pager}`
      : emptyTip('🦎', opts.emptyText || '当前筛选下没有在养个体'),
    page: p, pages,
  };
}

/* 绑定网格的翻页按钮 + 左右滑动手势
   v3.2：滑动跟手（touchmove 实时位移）+ 滑出/滑入动画 */
function bindAnimalGrid(root, list, getPage, setPage, size = PAGE_SIZE, gridId = 'g-grid') {
  const grid = root.querySelector('#' + gridId);
  const page = getPage();
  const pages = Math.max(1, Math.ceil(list.length / size));
  const atStart = page <= 1;
  const atEnd = page >= pages;

  /* 提交翻页：两段式动画
     ① 当前网格先「滑出 + 淡出」（165ms）
     ② 换页重渲染后，新网格用 anim-in-next / anim-in-prev「滑入 + 淡入」
     这样按钮翻页与手指滑动翻页都有连贯的横向动画。 */
  let committing = false;
  const commit = (np, dir) => {
    if (np === page || committing) return;
    if (!grid) { setPage(np, dir); return; }
    committing = true;
    grid.classList.remove('anim-in-next', 'anim-in-prev');
    grid.style.transition = 'transform .16s ease-in, opacity .16s ease-in';
    grid.style.transform = `translateX(${dir > 0 ? '-30px' : '30px'})`;
    grid.style.opacity = '0.15';
    setTimeout(() => setPage(np, dir), 165);
  };

  const go = (delta) => {
    const np = Math.min(Math.max(1, page + delta), pages);
    if (np !== page) commit(np, delta > 0 ? 1 : -1);
  };
  root.querySelectorAll('[data-gp]').forEach((b) => {
    b.onclick = () => go(b.dataset.gp === 'next' ? 1 : -1);
  });
  if (!grid) return;

  /* 滑动翻页（手机端）：
     - touchmove 实时跟手位移（transition 关闭）；
     - touchend 依据总位移判定是否翻页（阈值 = max(56px, 宽度×22%)），
       翻页则走 commit() 的滑出动画，未过阈值则回弹。 */
  let sx = 0, sy = 0, tracking = false, decided = false;
  const reset = () => {
    grid.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
    grid.style.transform = '';
    grid.style.opacity = '';
  };
  grid.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    tracking = true; decided = false;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    // 若入场动画还在跑，先清掉，避免动画的 transform 盖住跟手位移
    grid.classList.remove('anim-in-next', 'anim-in-prev');
    grid.style.transition = 'none';
    grid.style.transform = '';
  }, { passive: true });
  grid.addEventListener('touchmove', (e) => {
    if (!tracking || !e.touches || !e.touches.length) return;
    const t = e.touches[0];
    const ddx = t.clientX - sx, ddy = t.clientY - sy;
    if (!decided) {
      // 纵向优先 → 判定为页面滚动，放弃横向翻页
      if (Math.abs(ddy) > Math.abs(ddx) && Math.abs(ddy) > 10) { tracking = false; reset(); return; }
      if (Math.abs(ddx) <= 8) return;
      decided = true;
    }
    let off = ddx;
    // 首/末页做阻尼，给出「到边了」的反馈
    if ((ddx > 0 && atStart) || (ddx < 0 && atEnd)) off = ddx * 0.32;
    grid.style.transform = `translateX(${off}px)`;
  }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) { reset(); return; }
    const ddx = t.clientX - sx, ddy = t.clientY - sy;
    const thresh = Math.max(SWIPE_MIN, (grid.offsetWidth || 0) * 0.18);
    if (Math.abs(ddx) > thresh && Math.abs(ddx) > Math.abs(ddy) * 1.2) {
      const dir = ddx < 0 ? 1 : -1;   // 左滑 → 下一页
      const np = Math.min(Math.max(1, page + dir), pages);
      if (np !== page) { commit(np, dir); return; }
    }
    reset();
  }, { passive: true });
}

/* 按筛选条件取在养个体 */
function filteredAnimals() {
  let list = listAnimals({ status: 'active' }).filter((a) => !a.isArchived);
  if (state.planId) {
    const cageIds = listCages(state.planId).map((c) => c.id);
    list = list.filter((a) => cageIds.includes(a.cageId));
  }
  if (state.speciesId) list = list.filter((a) => a.speciesId === state.speciesId);
  return list;
}

function trendHtml(animalId) {
  const ms = listLogs(animalId, 'measure').slice().reverse(); // 正序
  const wPts = ms.filter((l) => l.data.weight != null).map((l) => ({ x: (l.createTime || '').slice(5, 16), y: Number(dispWeight(l.data.weight)) }));
  const lPts = ms.filter((l) => l.data.length != null).map((l) => ({ x: (l.createTime || '').slice(5, 16), y: Number(dispLength(l.data.length)) }));
  if (!wPts.length && !lPts.length) return `<div class="hint" style="padding:10px 4px">暂无测量记录，录一条后这里会出现曲线</div>`;
  return `
    <div style="font-size:12.5px;color:var(--muted);margin:6px 0 2px">体重（${unitWeight()}）· ${wPts.length} 个记录点</div>
    <div class="chart-wrap">${lineChart({ points: wPts, color: '#2e9e6b', unit: unitWeight() })}</div>
    <div style="font-size:12.5px;color:var(--muted);margin:14px 0 2px">体长（${unitLength()}）· ${lPts.length} 个记录点</div>
    <div class="chart-wrap">${lineChart({ points: lPts, color: '#e8912d', unit: unitLength() })}</div>`;
}

/* ---------- 测量记录 新增 / 编辑 表单（支持补录历史日期） ---------- */
async function measureFormModal(animalId, log) {
  const editing = !!log;
  const v = (id) => (document.getElementById(id) || {}).value || '';
  const res = await runModal({
    title: editing ? '编辑测量记录' : '添加测量记录',
    bodyHtml: `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:130px;margin:0"><label>日期</label>
          <input type="date" id="h-date" value="${editing ? (log.createTime || '').slice(0, 10) : todayStr()}"></div>
        <div class="field" style="flex:1;min-width:100px;margin:0"><label>时间</label>
          <input type="time" id="h-time" value="${editing ? (log.createTime || '').slice(11, 16) : nowStr().slice(11, 16)}"></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <div class="field" style="flex:1;min-width:120px;margin:0"><label>体重（${unitWeight()}，可空）</label>
          <input type="number" id="h-weight" min="0" step="0.1" placeholder="可空" value="${editing && log.data.weight != null && log.data.weight !== '' ? dispWeight(log.data.weight) : ''}"></div>
        <div class="field" style="flex:1;min-width:120px;margin:0"><label>体长（${unitLength()}，可空）</label>
          <input type="number" id="h-length" min="0" step="0.1" placeholder="可空" value="${editing && log.data.length != null && log.data.length !== '' ? dispLength(log.data.length) : ''}"></div>
      </div>
      <div class="hint" style="margin-top:8px">两项均可留空（至少填一项）；日期时间用于补录历史测量。</div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
  });
  if (!res) return false;
  const w = storeWeight(v('h-weight'));
  const l = storeLength(v('h-length'));
  if (w == null && l == null) { toast('体重和体长至少填一项', 'warn'); return false; }
  const date = v('h-date') || todayStr();
  const time = v('h-time') || nowStr().slice(11, 16);
  const createTime = `${date} ${time}`;
  const data = { weight: w == null ? '' : w, length: l == null ? '' : l };
  if (editing) { await updateLog(log.id, { data, createTime }); toast('已保存', 'ok'); }
  else { await addLog(animalId, 'measure', data, createTime); toast('已记录', 'ok'); }
  return true;
}

/* ---------- 历史记录弹窗：筛选 → 选个体 → 历史记录增删查改 ---------- */
async function historyModal(onChanged) {
  const hs = { planId: '', speciesId: '', geneId: '', animalId: '', page: 1, anim: '' };

  const animalsFiltered = () => {
    let list = listAnimals({ status: 'active' }).filter((a) => !a.isArchived);
    if (hs.planId) {
      const cageIds = listCages(hs.planId).map((c) => c.id);
      list = list.filter((a) => cageIds.includes(a.cageId));
    }
    if (hs.speciesId) list = list.filter((a) => a.speciesId === hs.speciesId);
    if (hs.geneId) list = list.filter((a) => (a.geneIds || []).includes(hs.geneId));
    return list;
  };

  await runModal({
    title: '成长记录 · 历史查询',
    bodyHtml: `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:130px;margin:0"><label>爬柜筛选</label>
          <select id="h-plan">
            <option value="">全部爬柜</option>
            ${listPlans().map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select></div>
        <div class="field" style="flex:1;min-width:130px;margin:0"><label>物种筛选</label>
          <select id="h-species">
            <option value="">全部物种</option>
            ${listSpecies().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
          </select></div>
        <div class="field" style="flex:1;min-width:130px;margin:0"><label>基因筛选</label>
          <select id="h-gene"><option value="">全部基因</option></select></div>
      </div>
      <div class="card" style="box-shadow:none;padding:10px;margin-top:10px">
        <div class="card-head"><h3 style="font-size:13.5px">选择个体</h3><span style="color:var(--muted);font-size:12px" id="h-count"></span></div>
        <div id="h-grid"></div>
      </div>
      <div id="h-history"></div>`,
    buttons: [{ text: '关闭', cls: 'ghost', value: null }],
    mount(mask, close) {
      const planSel = mask.querySelector('#h-plan');
      const spSel = mask.querySelector('#h-species');
      const geneSel = mask.querySelector('#h-gene');
      const gridBox = mask.querySelector('#h-grid');
      const countEl = mask.querySelector('#h-count');
      const historyBox = mask.querySelector('#h-history');

      function renderGeneOptions() {
        // 基因随物种联动：选了物种只列该物种基因，否则列全部（带物种名区分）
        const genes = listGenes(hs.speciesId).filter((g) => !g.isInvalid && g.type !== 'polygenic');
        geneSel.innerHTML = `<option value="">全部基因</option>` + genes.map((g) =>
          `<option value="${g.id}" ${g.id === hs.geneId ? 'selected' : ''}>${esc(g.name)}${hs.speciesId ? '' : '（' + esc(listSpecies().find((s) => s.id === g.speciesId) || {}).name + '）'}</option>`).join('');
      }
      function renderGrid() {
        const list = animalsFiltered();
        countEl.textContent = `${list.length} 只在养`;
        // v3.1：选择个体分页（每页 4 个）+ 手机端左右滑动翻页
        // v3.2：不再在每次渲染时把页码强制拉回「选中个体所在页」——
        //        否则用户翻页后立刻被拽回，翻页按钮与滑动翻页全部失效。
        const maxPage = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        if (hs.page > maxPage) hs.page = maxPage;
        if (hs.page < 1) hs.page = 1;
        const g = animalGridHtml(list, hs.page, hs.animalId, {
          gridId: 'h-grid-inner', emptyText: '当前筛选下没有在养个体', anim: hs.anim,
        });
        hs.anim = '';
        gridBox.innerHTML = g.html;
        gridBox.querySelectorAll('.growth-cell').forEach((c) => {
          c.onclick = () => { hs.animalId = c.dataset.id; renderGrid(); renderHistory(); };
        });
        bindAnimalGrid(gridBox, list, () => hs.page, (p, dir) => {
          hs.page = p;
          hs.anim = dir > 0 ? 'anim-in-next' : 'anim-in-prev';
          renderGrid();
        }, PAGE_SIZE, 'h-grid-inner');
      }
      function renderHistory() {
        const a = hs.animalId ? listAnimals().find((x) => x.id === hs.animalId) : null;
        if (!a) { historyBox.innerHTML = ''; return; }
        const logs = listLogs(hs.animalId, 'measure'); // 时间倒序
        historyBox.innerHTML = `
          <div class="card" style="box-shadow:none;padding:10px;margin-top:10px">
            <div class="card-head">
              <h3 style="font-size:13.5px">${esc(a.name)} 的历史记录</h3>
              <span style="color:var(--muted);font-size:12px">共 ${logs.length} 条</span>
            </div>
            ${logs.length ? `<div class="list">
              ${logs.map((l) => `
                <div class="row" style="cursor:default;padding:10px 12px">
                  <div class="row-main">
                    <div class="row-title" style="font-size:13.5px">${esc(l.createTime || '')}</div>
                    <div class="row-sub">体重 ${l.data.weight != null && l.data.weight !== '' ? esc(dispWeight(l.data.weight)) + unitWeight() : '—'} · 体长 ${l.data.length != null && l.data.length !== '' ? esc(dispLength(l.data.length)) + unitLength() : '—'}</div>
                  </div>
                  <div class="row-side" style="white-space:nowrap">
                    <button class="btn ghost sm" data-hedit="${l.id}">编辑</button>
                    <button class="btn ghost sm" data-hdel="${l.id}" style="color:var(--danger)">删</button>
                  </div>
                </div>`).join('')}
            </div>` : emptyTip('📏', '暂无测量记录，点击下方按钮添加')}
            <button class="btn" id="h-add" style="margin-top:10px">＋ 添加记录</button>
          </div>`;
        historyBox.querySelector('#h-add').onclick = async () => {
          const ok = await measureFormModal(hs.animalId, null);
          if (ok) { renderHistory(); if (onChanged) onChanged(); }
        };
        historyBox.querySelectorAll('[data-hedit]').forEach((b) => {
          b.onclick = async () => {
            const log = listLogs(hs.animalId, 'measure').find((x) => x.id === b.dataset.hedit);
            const ok = await measureFormModal(hs.animalId, log);
            if (ok) { renderHistory(); if (onChanged) onChanged(); }
          };
        });
        historyBox.querySelectorAll('[data-hdel]').forEach((b) => {
          b.onclick = async () => {
            const ok = await confirmDialog('删除测量记录', '删除后不可恢复。确定删除这条测量记录？', { okText: '删除', danger: true });
            if (!ok) return;
            await removeLog(b.dataset.hdel);
            toast('已删除', 'ok');
            renderHistory();
            if (onChanged) onChanged();
          };
        });
      }

      planSel.onchange = () => { hs.planId = planSel.value; hs.animalId = ''; hs.page = 1; renderGrid(); renderHistory(); };
      spSel.onchange = () => { hs.speciesId = spSel.value; hs.geneId = ''; renderGeneOptions(); hs.animalId = ''; hs.page = 1; renderGrid(); renderHistory(); };
      geneSel.onchange = () => { hs.geneId = geneSel.value; hs.animalId = ''; hs.page = 1; renderGrid(); renderHistory(); };

      renderGeneOptions();
      renderGrid();
      renderHistory();
    },
  });
}

export default {
  title: '成长记录',
  render(el) {
    const list = filteredAnimals();
    const cur = list.find((a) => a.id === state.selectedId) || null;
    if (cur && cur.id !== state.selectedId) state.selectedId = cur.id;
    // v3.2：页码不再被「选中个体所在页」强制覆盖——
    //        那样会让用户翻页后立刻被拽回第 1 页，翻页按钮与滑动翻页全部失效。
    //        仅做边界收敛（筛选变化导致总数变少时页码越界）。
    const maxPage = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > maxPage) state.page = maxPage;
    if (state.page < 1) state.page = 1;
    const grid = animalGridHtml(list, state.page, state.selectedId, {
      showWeight: true, gridId: 'g-grid', anim: state.anim,
    });
    state.anim = '';

    el.innerHTML = `
      ${pageHead('成长记录', '选个体 → 录体重体长 → 看成长曲线',
        `<button class="btn ghost" id="btn-history">📈 历史记录</button>`)}
      <div class="card" style="box-shadow:none;padding:12px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:140px;margin:0"><label>爬柜筛选</label>
            <select id="g-plan">
              <option value="">全部爬柜</option>
              ${listPlans().map((p) => `<option value="${p.id}" ${p.id === state.planId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:1;min-width:140px;margin:0"><label>物种筛选</label>
            <select id="g-species">
              <option value="">全部物种</option>
              ${listSpecies().map((s) => `<option value="${s.id}" ${s.id === state.speciesId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>选择个体</h3><span style="color:var(--muted);font-size:12px">${list.length} 只在养</span></div>
        ${grid.html}
      </div>
      ${cur ? `
      <div class="card">
        <h3>录入 · ${esc(cur.name)}</h3>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:120px;margin:0"><label>体重（${unitWeight()}，可空）</label>
            <input type="number" id="g-weight" min="0" step="0.1" placeholder="可空" value="${cur.weight != null ? dispWeight(cur.weight) : ''}"></div>
          <div class="field" style="flex:1;min-width:120px;margin:0"><label>体长（${unitLength()}，可空）</label>
            <input type="number" id="g-length" min="0" step="0.1" placeholder="可空" value="${cur.length != null ? dispLength(cur.length) : ''}"></div>
          <button class="btn" id="g-record" style="margin-bottom:2px">记录</button>
        </div>
        <div class="hint" style="margin-top:8px">两项均可留空；点击记录后按当前时间写入测量日志，并刷新下方曲线。</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${esc(cur.name)} 的成长曲线</h3></div>
        <div id="g-trend">${trendHtml(cur.id)}</div>
      </div>` : ''}
    `;

    el.querySelector('#btn-history').onclick = () => historyModal(() => this.render(el));
    el.querySelector('#g-plan').onchange = (e) => { state.planId = e.target.value; state.selectedId = ''; state.page = 1; this.render(el); };
    el.querySelector('#g-species').onchange = (e) => { state.speciesId = e.target.value; state.selectedId = ''; state.page = 1; this.render(el); };
    bindAnimalGrid(el, list, () => state.page, (p, dir) => {
      state.page = p;
      state.anim = dir > 0 ? 'anim-in-next' : 'anim-in-prev';
      this.render(el);
    }, PAGE_SIZE, 'g-grid');
    el.querySelectorAll('.growth-cell').forEach((c) => {
      c.onclick = () => { state.selectedId = c.dataset.id; this.render(el); };
    });
    const rec = el.querySelector('#g-record');
    if (rec) rec.onclick = async () => {
      const w = storeWeight(el.querySelector('#g-weight').value);
      const l = storeLength(el.querySelector('#g-length').value);
      if (w == null && l == null) { toast('体重和体长至少填一项', 'warn'); return; }
      await addLog(state.selectedId, 'measure', { weight: w == null ? '' : w, length: l == null ? '' : l });
      toast('已记录', 'ok');
      this.render(el);
    };
  },
};
