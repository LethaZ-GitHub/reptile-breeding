// pages/todos.js —— 工单管理：全部工单的筛选 / 搜索 / 增删查改 / 导出导入
'use strict';

import { App } from '../app.js';
import { esc, toast, todayStr, daysBetween, confirmDialog, runModal, download, nowStr, nowIso, readFileAsText, pagerHtml, bindPager } from '../util.js';
import { xlsxBlob, readXlsxFile, rowsToSheet, sheetToRows } from '../xlsx.js';
import { pageHead, emptyTip } from '../ui.js';
import {
  listAllTodos, createCustomTodo, updateTodo, removeTodo, completeTodo, reopenTodo,
  validateTodoPkg, importTodos, getAnimal, getCage, getPairing, updatePairing, S,
} from '../store.js';
import { pairResultModal } from './pairings.js';

const SRC = {
  'cage-clean': { label: '爬箱清理', cls: 'cage' },
  'egg-hatch': { label: '破壳提醒', cls: 'egg' },
  'laying-check': { label: '产卵检查', cls: 'laying' },
  'pairing-check': { label: '产卵检查', cls: 'laying' },
  'custom': { label: '自定义', cls: 'custom' },
};
const ST = {
  pending: { label: '待办', cls: 'st-unknown' },
  done: { label: '已完成', cls: 'st-ok' },
  cancelled: { label: '已取消', cls: 'st-dead' },
};
const PAGE = 15;

/* ---------- 新建 / 编辑工单 ---------- */
async function editTodoFlow(todo, done) {
  const isNew = !todo;
  const res = await runModal({
    title: isNew ? '新建工单' : '编辑工单',
    bodyHtml: `
      <div class="field"><label>工单内容<span class="req">*</span></label><input type="text" id="tk-title" value="${esc(todo ? todo.title : '')}" placeholder="例如：补充钙粉、预约看诊"></div>
      <div class="field"><label>截止日期<span class="req">*</span></label><input type="date" id="tk-date" value="${todo ? (todo.deadline || todayStr()) : todayStr()}"></div>
      ${isNew ? '' : `<div class="field"><label>状态</label><select id="tk-status">
        <option value="pending" ${todo.status === 'pending' ? 'selected' : ''}>待办</option>
        <option value="done" ${todo.status === 'done' ? 'selected' : ''}>已完成</option>
        <option value="cancelled" ${todo.status === 'cancelled' ? 'selected' : ''}>已取消</option>
      </select></div>`}
      <div class="hint">${isNew ? '新建后可在列表中继续编辑、延期或标记完成。' : '修改截止日期后，列表中的倒计时与首页待办同步更新。'}</div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
  });
  if (!res) return;
  const title = document.getElementById('tk-title').value.trim();
  const date = document.getElementById('tk-date').value;
  if (!title || !date) { toast('请填写完整', 'warn'); return; }
  if (isNew) {
    await createCustomTodo(title, date);
    toast('工单已创建', 'ok');
  } else {
    const status = (document.getElementById('tk-status') || {}).value || todo.status;
    await updateTodo(todo.id, { title, deadline: date, status });
    toast('已保存', 'ok');
  }
  if (done) done();
}

/* ---------- 延期 ---------- */
async function delayFlow(t, done) {
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
  await updateTodo(t.id, { deadline: d });
  toast(`已延期到 ${d}`, 'ok');
  if (done) done();
}

export default {
  title: '工单管理',
  render(el) {
    const state = { status: '', src: '', q: '', page: 1 };

    el.innerHTML = `
      ${pageHead('工单管理', '全部工单统一管理：筛选、搜索、增删改、导出导入',
        `<button class="btn" id="btn-add">＋ 新建工单</button>
         <button class="btn ghost" id="btn-export">📤 导出</button>
         <button class="btn ghost" id="btn-import">📥 导入</button>`)}
      <div class="card">
        <div class="seg" id="f-status">
          <div class="seg-item active" data-v="">全部</div>
          <div class="seg-item" data-v="pending">待办</div>
          <div class="seg-item" data-v="done">已办</div>
          <div class="seg-item" data-v="cancelled">已取消</div>
        </div>
        <div class="search-box">
          <select id="f-src"><option value="">全部来源</option></select>
          <input type="text" id="f-q" placeholder="搜索工单内容…">
        </div>
        <div class="list list-grid" id="tk-list"></div>
        <div id="tk-pager"></div>
      </div>
      <input type="file" id="file-import" accept=".xlsx,.json,application/json" style="display:none">
    `;

    // 来源下拉（按当前数据动态生成）
    const srcSel = el.querySelector('#f-src');
    const srcTypes = [...new Set(listAllTodos().map((t) => t.sourceType).filter(Boolean))];
    srcSel.innerHTML = `<option value="">全部来源</option>` + srcTypes.map((s) =>
      `<option value="${esc(s)}">${esc((SRC[s] || { label: s }).label)}</option>`).join('');

    function filtered() {
      const kw = state.q.trim().toLowerCase();
      return listAllTodos().filter((t) => {
        if (state.status && t.status !== state.status) return false;
        if (state.src && t.sourceType !== state.src) return false;
        if (kw && !(t.title || '').toLowerCase().includes(kw)) return false;
        return true;
      });
    }

    function jumpOf(t) {
      if (t.sourceType === 'egg-hatch') return `#/egg/${t.sourceId}`;
      // v2.6：产卵检查（关联配对记录）改弹窗展示，不再跳页
      if (t.sourceType === 'pairing-check') return '';
      if (t.sourceType === 'laying-check' && getAnimal(t.sourceId)) return `#/animal/${t.sourceId}`;
      if (t.sourceType === 'cage-clean') { const c = getCage(t.sourceId); if (c) return `#/cage/${c.planId}`; }
      return '';
    }
    // 「查看关联」：配对类待办弹出配对记录详情（只读信息 + 确认结果/备注后同步）；其余保持跳转
    const viewLinkHtml = (t, jump) => (t.sourceType === 'pairing-check' && getPairing(t.sourceId))
      ? ` · <a href="javascript:void(0)" data-act="view-pair">查看关联 →</a>`
      : (jump ? ` · <a href="${jump}">查看关联 →</a>` : '');

    function renderList() {
      const rows = filtered();
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      state.page = Math.min(Math.max(1, state.page), pages);
      const page = rows.slice((state.page - 1) * PAGE, state.page * PAGE);
      const box = el.querySelector('#tk-list');
      box.innerHTML = page.length ? page.map((t) => {
        const st = ST[t.status] || ST.pending;
        const src = SRC[t.sourceType] || { label: t.sourceType || '其他', cls: 'custom' };
        const jump = jumpOf(t);
        const left = daysBetween(todayStr(), t.deadline);
        const dl = t.deadline
          ? (left < 0 ? `<span class="countdown overdue">已逾期 ${-left} 天</span>` : left === 0 ? '<span class="countdown soon">今天到期</span>' : `<span class="countdown">还剩 ${left} 天</span>`)
          : '无截止日期';
        return `<div class="todo-item" data-id="${t.id}">
          <div class="tk-body">
            <div class="tk-title">${esc(t.title)}</div>
            <div class="tk-meta">
              <span class="tk-src ${src.cls}">${esc(src.label)}</span>
              <span class="st ${st.cls}">${st.label}</span>
              截止 ${esc(t.deadline || '—')} · ${dl}
              ${t.status === 'done' && t.doneAt ? ` · 完成于 ${esc(t.doneAt)}` : ''}
              ${t.status === 'cancelled' && t.cancelledAt ? ` · 取消于 ${esc(t.cancelledAt)}` : ''}
              ${viewLinkHtml(t, jump)}
            </div>
          </div>
          <div class="tk-acts">
            ${t.status === 'pending' ? '<button class="btn ghost sm" data-act="done">完成</button>' : '<button class="btn ghost sm" data-act="reopen">恢复</button>'}
            <button class="btn ghost sm" data-act="edit">编辑</button>
            ${t.status === 'pending' ? '<button class="btn ghost sm" data-act="delay">延期</button>' : ''}
            <button class="btn ghost sm" data-act="del" style="color:var(--danger)">删除</button>
          </div>
        </div>`;
      }).join('') : emptyTip('🗂️', '没有符合条件的工单');
      box.querySelectorAll('.todo-item').forEach((row) => {
        const id = row.dataset.id;
        const t = listAllTodos().find((x) => x.id === id);
        const doneBtn = row.querySelector('[data-act="done"]');
        if (doneBtn) doneBtn.onclick = async () => {
          // 产卵检查待办（仅关联配对记录）：完成时先登记配对结果与备注，同步配对记录
          if (t && t.sourceType === 'pairing-check') {
            const p = getPairing(t.sourceId);
            if (p) {
              const patch = await pairResultModal(p);
              if (!patch) return;
              await updatePairing(p.id, patch);   // 先同步配对记录（改期会复活待办，故必须在完成前）
              await completeTodo(id);
              toast('配对结果已记录，待办完成', 'ok');
              renderList();
              return;
            }
          }
          await completeTodo(id); toast('已完成', 'ok'); renderList();
        };
        // 查看关联：配对类待办弹窗展示配对记录详情，确认结果/备注后同步回配对记录
        const viewPairBtn = row.querySelector('[data-act="view-pair"]');
        if (viewPairBtn) viewPairBtn.onclick = async () => {
          const p = getPairing(t.sourceId);
          if (!p) { toast('配对记录不存在或已删除', 'warn'); return; }
          const patch = await pairResultModal(p, { mode: 'view' });
          if (!patch) return;
          await updatePairing(p.id, patch);
          toast('已同步到配对记录', 'ok');
          renderList();
        };
        const reopenBtn = row.querySelector('[data-act="reopen"]');
        if (reopenBtn) reopenBtn.onclick = async () => { await reopenTodo(id); toast('已恢复为待办', 'ok'); renderList(); };
        row.querySelector('[data-act="edit"]').onclick = () => editTodoFlow(t, renderList);
        const delayBtn = row.querySelector('[data-act="delay"]');
        if (delayBtn) delayBtn.onclick = () => delayFlow(t, renderList);
        row.querySelector('[data-act="del"]').onclick = async () => {
          const ok = await confirmDialog('删除工单', `确定删除「${t.title}」吗？此操作不可恢复。`, { okText: '删除', danger: true });
          if (!ok) return;
          await removeTodo(id);
          toast('已删除');
          renderList();
        };
      });
      el.querySelector('#tk-pager').innerHTML = pagerHtml(state.page, rows.length, PAGE);
      bindPager(el.querySelector('#tk-pager'), (p) => { state.page = p; renderList(); });
    }

    el.querySelector('#f-status').addEventListener('click', (e) => {
      const item = e.target.closest('.seg-item');
      if (!item) return;
      el.querySelectorAll('#f-status .seg-item').forEach((x) => x.classList.remove('active'));
      item.classList.add('active');
      state.status = item.dataset.v; state.page = 1;
      renderList();
    });
    srcSel.onchange = () => { state.src = srcSel.value; state.page = 1; renderList(); };
    el.querySelector('#f-q').addEventListener('input', (e) => { state.q = e.target.value; state.page = 1; renderList(); });

    el.querySelector('#btn-add').onclick = () => editTodoFlow(null, renderList);

    /* ---------- 导出（当前筛选结果 → Excel 表格） ---------- */
    el.querySelector('#btn-export').onclick = () => {
      const rows = filtered();
      if (!rows.length) { toast('当前筛选下没有工单', 'warn'); return; }
      const stamp = nowStr().replace(/[-: ]/g, '').slice(0, 12);
      download(`养个爬工单_${stamp}.xlsx`, xlsxBlob([{ name: '工单', rows: rowsToSheet(rows) }]));
      toast(`已导出 ${rows.length} 条工单（Excel）`, 'ok');
    };

    /* ---------- 导入（Excel 或旧版 JSON，按 ID 覆盖合并） ---------- */
    el.querySelector('#btn-import').onclick = () => el.querySelector('#file-import').click();
    el.querySelector('#file-import').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let pkg;
      try {
        if (/\.xlsx$/i.test(file.name) || (file.type || '').includes('sheet')) {
          const { sheets } = await readXlsxFile(file);
          const sheet = sheets.find((s) => s.name !== '_meta') || sheets[0];
          const rows = sheetToRows(sheet.rows);
          pkg = { app: 'reptile-breeding-todos', format: 1, exportedAt: nowIso(), counts: { todo: rows.length }, todos: rows };
        } else {
          pkg = JSON.parse(await readFileAsText(file));
        }
        validateTodoPkg(pkg);
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
        return;
      }
      const ok = await confirmDialog('确认导入工单',
        `备份包导出时间：${(pkg.exportedAt || '').replace('T', ' ').slice(0, 19)}\n共 ${(pkg.todos || []).length} 条工单。\n导入按 ID 覆盖合并：同 ID 工单将被备份内容覆盖，其他工单不受影响。确定导入？`,
        { okText: '确认导入' });
      if (!ok) return;
      try {
        const r = await importTodos(pkg);
        toast(`导入完成：新增 ${r.added} 条，覆盖 ${r.updated} 条`, 'ok');
        renderList();
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
      }
    };

    renderList();
  },
};
