// pages/home.js —— 首页：待办任务列表（待办 / 计划中 / 已办 三标签）
'use strict';

import { App } from '../app.js';
import { esc, toast, todayStr, daysBetween, confirmDialog, promptDialog, runModal } from '../util.js';
import { pageHead, emptyTip, deadlineMeta, animalThumbHtml } from '../ui.js';
import {
  listTodos, completeTodo, delayTodo, cancelTodo, createCustomTodo, updateTodo,
  listAnimals, listEggs, allAnimals, refreshAutoTodos, getAnimal, getCage, animalName,
  listPlans, listCages, listSpecies, getPairing, updatePairing,
} from '../store.js';
import { pairResultModal } from './pairings.js';
import { batchLogFormModal } from '../log-form.js';

const SRC = {
  'cage-clean': { label: '爬箱清理', cls: 'cage' },
  'egg-hatch': { label: '破壳提醒', cls: 'egg' },
  'laying-check': { label: '产卵检查', cls: 'laying' },
  'pairing-check': { label: '产卵检查', cls: 'laying' },
  'custom': { label: '自定义', cls: 'custom' },
};

/* ---------- 喂养记录：选类型 → 勾选个体（可按爬柜/物种筛选）→ 批量记录 ---------- */
async function feedingFlow() {
  // 第一步：选择记录类型（喂食 / 医疗）
  const logType = await runModal({
    title: '喂养记录',
    bodyHtml: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <button class="btn" id="ff-feed" style="padding:20px 10px;font-size:15px">🍽<br>喂食</button>
        <button class="btn" id="ff-med" style="padding:20px 10px;font-size:15px">💉<br>医疗</button>
      </div>
      <div class="hint" style="margin-top:12px">选择类型后，勾选本次操作的个体（可多选）</div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }],
    mount: (mask, close) => {
      mask.querySelector('#ff-feed').onclick = () => close('feed');
      mask.querySelector('#ff-med').onclick = () => close('medical');
    },
  });
  if (!logType) return;

  // 第二步：个体多选
  const picked = await new Promise((resolve) => {
    const sel = new Set();
    const animals = () => {
      let list = listAnimals({ status: 'active' });
      const p = (document.getElementById('ff-plan') || {}).value;
      const sp = (document.getElementById('ff-species') || {}).value;
      if (p) { const cids = listCages(p).map((c) => c.id); list = list.filter((a) => cids.includes(a.cageId)); }
      if (sp) list = list.filter((a) => a.speciesId === sp);
      return list;
    };
    const draw = (mask) => {
      const list = animals();
      const ids = list.map((a) => a.id);
      const allChecked = ids.length > 0 && ids.every((id) => sel.has(id));
      const selAllBtn = mask.querySelector('#ff-selall');
      if (selAllBtn) {
        selAllBtn.textContent = allChecked ? '☑ 取消全选' : '☑ 全选';
        selAllBtn.style.display = ids.length ? '' : 'none';
        selAllBtn.onclick = () => {
          if (allChecked) ids.forEach((id) => sel.delete(id));
          else ids.forEach((id) => sel.add(id));
          draw(mask);
        };
      }
      mask.querySelector('#ff-list').innerHTML = list.map((a) => `
        <label class="pick-row ${sel.has(a.id) ? 'picked' : ''}" data-id="${a.id}">
          <input type="checkbox" ${sel.has(a.id) ? 'checked' : ''}>
          ${animalThumbHtml(a)}
          <span class="pr-name">${esc(a.name)}</span>
          <span class="pr-sub">${esc(listSpecies().find((s) => s.id === a.speciesId)?.name || '')}</span>
        </label>`).join('') || '<div class="hint">当前筛选下没有在养个体</div>';
      mask.querySelectorAll('#ff-list .pick-row').forEach((r) => {
        // v2.6：监听复选框 change 而非行 click——label 包裹时点击行体会先触发行 click、
        // 再由 label 转发到复选框产生第二次 click，两侧互相抵消导致「点行体无反应」；
        // 改听 change 后：直接点复选框 / 点行体（label 转发）均只生效一次
        const cb = r.querySelector('input');
        if (!cb) return;
        cb.onchange = () => {
          const id = r.dataset.id;
          if (cb.checked) sel.add(id); else sel.delete(id);
          r.classList.toggle('picked', cb.checked);
          const c = mask.querySelector('#ff-count');
          if (c) c.textContent = String(sel.size);
        };
      });
      const c = mask.querySelector('#ff-count');
      if (c) c.textContent = String(sel.size);
    };
    runModal({
      title: logType === 'feed' ? '🍽 喂食记录' : '💉 医疗记录',
      bodyHtml: `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div class="field" style="flex:1;min-width:130px;margin:0"><label>爬柜筛选</label>
            <select id="ff-plan"><option value="">全部爬柜</option>${listPlans().map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field" style="flex:1;min-width:130px;margin:0"><label>物种筛选</label>
            <select id="ff-species"><option value="">全部物种</option>${listSpecies().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
          <div class="hint" style="margin:0">已选 <b id="ff-count">0</b> 只 · 确认后按当前日期时间记录</div>
          <button class="btn ghost sm" id="ff-selall">☑ 全选</button>
        </div>
        <div class="pick-list" id="ff-list"></div>`,
      buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '确定记录', value: 'ok' }],
      mount: (mask, close) => {
        draw(mask);
        mask.querySelector('#ff-plan').onchange = () => draw(mask);
        mask.querySelector('#ff-species').onchange = () => draw(mask);
        // 重绑底部按钮：确定时 resolve 已选集合，取消/关闭 resolve null
        mask.querySelector('.m-foot').querySelectorAll('button').forEach((b) => {
          b.onclick = () => { close(b.textContent === '确定记录' ? [...sel] : null); };
        });
      },
    }).then((v) => resolve(Array.isArray(v) ? v : null));
  });

  if (!picked || !picked.length) { if (picked) toast('未选择个体', 'warn'); return; }
  // v3.3：选中个体后弹出与个体详情页完全一致的喂食/医疗表单，
  //       填入的信息为每个选中个体各生成一条独立记录。
  const animals = picked.map((id) => listAnimals().find((a) => a.id === id)).filter(Boolean);
  const speciesIds = [...new Set(animals.map((a) => a.speciesId).filter(Boolean))];
  const n = await batchLogFormModal(picked, logType, speciesIds);
  if (!n) return;
  toast(`已记录 ${n} 只${logType === 'feed' ? '喂食' : '医疗'}`, 'ok');
  App.refresh();
}

function todoRowHtml(t) {
  const left = daysBetween(todayStr(), t.deadline);
  const overdue = left < 0;
  const src = SRC[t.sourceType] || SRC.custom;
  let jump = '';
  if (t.sourceType === 'egg-hatch') jump = `#/egg/${t.sourceId}`;
  // v2.6：产卵检查（关联配对记录）改弹窗展示，不再跳页
  else if (t.sourceType === 'laying-check' && getAnimal(t.sourceId)) jump = `#/animal/${t.sourceId}`;
  else if (t.sourceType === 'cage-clean') {
    const c = getCage(t.sourceId);
    if (c) jump = `#/cage/${c.planId}`;
  }
  const pairView = t.sourceType === 'pairing-check' && getPairing(t.sourceId);
  return `<div class="todo-item" data-id="${t.id}" style="${overdue ? 'outline:1px solid rgba(208,69,59,.4)' : ''}">
    <div class="tk-check" data-act="done" title="标记完成">✔</div>
    <div class="tk-body">
      <div class="tk-title">${esc(t.title)}</div>
      <div class="tk-meta">
        <span class="tk-src ${src.cls}">${src.label}</span>
        ${deadlineMeta(t.deadline)}
        ${pairView ? ` · <a href="javascript:void(0)" data-act="view-pair">查看关联 →</a>` : (jump ? ` · <a href="${jump}" data-act="jump">查看关联 →</a>` : '')}
      </div>
    </div>
    <div class="tk-acts">
      <button class="btn ghost sm" data-act="delay">延期</button>
      ${t.sourceType === 'custom' ? '<button class="btn ghost sm" data-act="cancel" style="color:var(--danger)">删除</button>' : ''}
    </div>
  </div>`;
}

function doneRowHtml(t) {
  const src = SRC[t.sourceType] || SRC.custom;
  const cancelled = t.status === 'cancelled';
  return `<div class="todo-item" data-id="${t.id}" style="opacity:.62">
    <div class="tk-check" style="border-color:var(--brand);color:var(--brand)">✔</div>
    <div class="tk-body">
      <div class="tk-title" style="text-decoration:line-through">${esc(t.title)}</div>
      <div class="tk-meta">
        <span class="tk-src ${src.cls}">${src.label}</span>
        ${cancelled ? `已取消 ${esc(t.cancelledAt || '')}` : `完成于 ${esc(t.doneAt || '')}`} · 截止 ${esc(t.deadline || '')}
      </div>
    </div>
    <div class="tk-acts">
      <button class="btn ghost sm" data-act="reopen">恢复</button>
    </div>
  </div>`;
}

async function addCustomTodo() {
  const res = await runModal({
    title: '新建待办',
    bodyHtml: `
      <div class="field"><label>待办内容<span class="req">*</span></label><input type="text" id="tk-title" placeholder="例如：补充钙粉、预约看诊"></div>
      <div class="field"><label>截止日期<span class="req">*</span></label><input type="date" id="tk-date" value="${todayStr()}"></div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '创建', value: 'ok' }],
  });
  if (!res) return;
  const title = document.getElementById('tk-title').value.trim();
  const date = document.getElementById('tk-date').value;
  if (!title || !date) { toast('请填写完整', 'warn'); return; }
  await createCustomTodo(title, date);
  toast('待办已创建', 'ok');
  App.refresh();
}

async function delayTodoFlow(id) {
  const t = listTodos().find((x) => x.id === id && x.status === 'pending');
  if (!t) return;
  const res = await runModal({
    title: '延期待办',
    bodyHtml: `
      <div style="font-size:13px;margin-bottom:10px">${esc(t.title)}</div>
      <div class="field"><label>新的截止日期</label><input type="date" id="tk-newdate" value="${t.deadline || todayStr()}"></div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '确定延期', value: 'ok' }],
  });
  if (!res) return;
  const d = document.getElementById('tk-newdate').value;
  if (!d) { toast('请选择日期', 'warn'); return; }
  await delayTodo(id, d);
  toast(`已延期到 ${d}`, 'ok');
  App.refresh();
}

export default {
  title: '首页待办',
  async render(el) {
    await refreshAutoTodos();
    const all = listTodos();
    const pending = all.filter((t) => t.status === 'pending');
    // 待办：已到期需处理（截止日 ≤ 今天，含今天到期与已逾期）
    const due = pending.filter((t) => daysBetween(todayStr(), t.deadline) <= 0);
    // 计划中：还未到期、仍在处理中的工单
    const planned = pending.filter((t) => daysBetween(todayStr(), t.deadline) > 0);
    // 已办：所有已处理的工单（已完成 + 已取消）
    const finished = all.filter((t) => t.status !== 'pending')
      .sort((x, y) => (y.doneAt || y.cancelledAt || '').localeCompare(x.doneAt || x.cancelledAt || ''));
    const overdueN = pending.filter((t) => daysBetween(todayStr(), t.deadline) < 0).length;
    const active = listAnimals({ status: 'active' });
    const fertileEggs = listEggs({ archived: false }).filter((e) => e.status === 'fertile').length;

    const state = { tab: 'due' };
    const TABS = [
      { key: 'due', label: '待办', n: due.length },
      { key: 'planned', label: '计划中', n: planned.length },
      { key: 'done', label: '已办', n: finished.length },
    ];

    // v2.9：桌面端右侧概览栏（手机端隐藏），用于填充 1440px 下的右侧大片留白
    const cageCount = listPlans().reduce((n, p) => n + listCages(p.id).length, 0);
    const speciesStat = listSpecies().map((sp) => {
      const n = active.filter((a) => a.speciesId === sp.id).length;
      return { name: sp.name, n };
    }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    const recentAnimals = active.slice(0, 6);

    el.innerHTML = `
      ${pageHead('首页待办', '清理、破壳、产卵检查与自定义待办汇总', `<button class="btn" id="btn-feeding">🍽 喂养记录</button><button class="btn ghost" id="btn-add-todo">＋ 新建待办</button>`)}
      <div class="home-grid">
        <div class="home-main">
          <div class="metrics">
            <div class="metric"><div class="m-label">待处理</div><div class="m-value">${pending.length}</div></div>
            <div class="metric accent"><div class="m-label">已逾期</div><div class="m-value">${overdueN}</div></div>
            <div class="metric"><div class="m-label">在养个体</div><div class="m-value">${active.length}</div></div>
            <div class="metric"><div class="m-label">受精蛋</div><div class="m-value">${fertileEggs}</div></div>
          </div>
          <div class="card">
            <div class="card-head"><h3>工单列表</h3><button class="btn ghost sm" id="btn-goto-todos">📋 工单管理</button></div>
            <div class="seg" id="todo-tabs">
              ${TABS.map((t) => `<div class="seg-item ${t.key === state.tab ? 'active' : ''}" data-tab="${t.key}">${t.label} <b>${t.n}</b></div>`).join('')}
            </div>
            <div class="list list-grid" id="todo-list"></div>
          </div>
        </div>
        <aside class="home-side">
          <div class="card">
            <div class="card-head"><h3>爬柜概览</h3></div>
            <div class="legend" style="margin:0">
              <span class="lg"><span class="tag-dot" style="background:var(--brand)"></span>爬柜方案 <b>${listPlans().length}</b></span>
              <span class="lg"><span class="tag-dot" style="background:var(--accent)"></span>爬箱 <b>${cageCount}</b></span>
              <span class="lg"><span class="tag-dot" style="background:#7a5fd0"></span>在养个体 <b>${active.length}</b></span>
              <span class="lg"><span class="tag-dot" style="background:var(--income)"></span>受精蛋 <b>${fertileEggs}</b></span>
            </div>
            ${speciesStat.length ? `<div class="side-block">
              <div class="side-title">按物种分布</div>
              ${speciesStat.map((s) => `<div class="side-row"><span class="side-name">${esc(s.name)}</span><span class="side-num">${s.n}</span></div>`).join('')}
            </div>` : ''}
            ${recentAnimals.length ? `<div class="side-block">
              <div class="side-title">在养个体</div>
              ${recentAnimals.map((a) => `<div class="side-row" data-route="#/animal/${a.id}"><span class="side-name">${esc(a.name)}</span><span class="side-num">${esc(a.code || '—')}</span></div>`).join('')}
            </div>` : ''}
          </div>
        </aside>
      </div>
    `;

    el.querySelectorAll('.home-side .side-row[data-route]').forEach((r) => { r.onclick = () => App.go(r.dataset.route); });

    const listBox = el.querySelector('#todo-list');
    function renderList() {
      const rows = state.tab === 'due' ? due : state.tab === 'planned' ? planned : finished;
      el.querySelectorAll('#todo-tabs .seg-item').forEach((x) => x.classList.toggle('active', x.dataset.tab === state.tab));
      if (!rows.length) {
        const tip = state.tab === 'due' ? '🎉 没有到期待办，一切井然有序'
          : state.tab === 'planned' ? '📅 暂无计划中的工单' : '🗂️ 暂无已办工单';
        listBox.innerHTML = emptyTip(state.tab === 'due' ? '🎉' : state.tab === 'planned' ? '📅' : '🗂️', tip);
        return;
      }
      listBox.innerHTML = rows.map((t) => (state.tab === 'done' ? doneRowHtml(t) : todoRowHtml(t))).join('');
      listBox.querySelectorAll('.todo-item').forEach((row) => {
        const id = row.dataset.id;
        const t = listTodos().find((x) => x.id === id);
        const done = row.querySelector('[data-act="done"]');
        if (done) done.onclick = async () => {
          // 产卵检查待办（仅关联配对记录）：完成时先登记配对结果与备注，同步配对记录
          if (t && t.sourceType === 'pairing-check') {
            const p = getPairing(t.sourceId);
            if (p) {
              const patch = await pairResultModal(p);
              if (!patch) return;
              await updatePairing(p.id, patch);   // 先同步配对记录（改期会复活待办，故必须在完成前）
              await completeTodo(id);
              toast('配对结果已记录，待办完成', 'ok');
              App.refresh();
              return;
            }
          }
          await completeTodo(id);
          toast('已完成', 'ok');
          App.refresh();
        };
        const delayBtn = row.querySelector('[data-act="delay"]');
        if (delayBtn) delayBtn.onclick = () => delayTodoFlow(id);
        // 查看关联：配对类待办弹窗展示配对记录详情，确认结果/备注后同步回配对记录
        const viewPairBtn = row.querySelector('[data-act="view-pair"]');
        if (viewPairBtn) viewPairBtn.onclick = async () => {
          const p = getPairing(t.sourceId);
          if (!p) { toast('配对记录不存在或已删除', 'warn'); return; }
          const patch = await pairResultModal(p, { mode: 'view' });
          if (!patch) return;
          await updatePairing(p.id, patch);
          toast('已同步到配对记录', 'ok');
          App.refresh();
        };
        const cancelBtn = row.querySelector('[data-act="cancel"]');
        if (cancelBtn) cancelBtn.onclick = async () => {
          const ok = await confirmDialog('删除待办', '确定删除这条自定义待办吗？', { okText: '删除', danger: true });
          if (!ok) return;
          await cancelTodo(id);
          toast('已删除');
          App.refresh();
        };
        const reopenBtn = row.querySelector('[data-act="reopen"]');
        if (reopenBtn) reopenBtn.onclick = async () => {
          await updateTodo(id, { status: 'pending' });
          toast('已恢复为待办', 'ok');
          App.refresh();
        };
      });
    }
    el.querySelectorAll('#todo-tabs .seg-item').forEach((x) => {
      x.onclick = () => { state.tab = x.dataset.tab; renderList(); };
    });
    renderList();

    el.querySelector('#btn-add-todo').onclick = addCustomTodo;
    el.querySelector('#btn-feeding').onclick = feedingFlow;
    // v2.6：工单管理入口移到首页工单列表最右侧
    el.querySelector('#btn-goto-todos').onclick = () => App.go('#/todos');
  },
};
