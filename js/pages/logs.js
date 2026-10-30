// pages/logs.js —— 饲养日志：全量喂食 / 医疗记录，支持搜索、筛选、多选与批量删除
'use strict';

import { esc, pagerHtml, bindPager, pageInfo, confirmDialog, toast } from '../util.js';
import { pageHead, emptyTip } from '../ui.js';
import { S, animalName, speciesName, listPlans, listCages, LOG_TYPES, removeLog } from '../store.js';
import { openFoodLibrary } from '../foodlib.js';
import { logFormModal } from '../log-form.js';

const SIZE = 15;
const state = { type: '', speciesId: '', planId: '', q: '', page: 1, checked: new Set() };

const TYPE_LABEL = { feed: '喂食', medical: '医疗' };
const TYPE_CLS = { feed: 'log-feed', medical: 'log-med' };

function dataText(logType, d) {
  d = d || {};
  if (logType === 'feed') {
    const parts = [];
    if (d.food) parts.push(d.food);
    const amt = d.qty != null && d.qty !== '' ? d.qty : d.amount;
    if (amt != null && amt !== '') parts.push(`×${amt}`);
    if (d.ate) parts.push(d.ate);
    return parts.join(' ') || '';
  }
  if (logType === 'medical') return d.note || d.treatment || d.symptom || '';
  return '';
}

function filtered() {
  let list = S.animal_log.filter((l) => l.logType === 'feed' || l.logType === 'medical');
  const kw = state.q.trim().toLowerCase();
  if (kw) {
    list = list.filter((l) => {
      const a = S.animal.find((x) => x.id === l.animalId);
      return (a && (a.name || '').toLowerCase().includes(kw)) || dataText(l.logType, l.data).toLowerCase().includes(kw);
    });
  }
  if (state.type) list = list.filter((l) => l.logType === state.type);
  if (state.speciesId || state.planId) {
    let ids = null;
    if (state.planId) ids = listCages(state.planId).map((c) => c.id);
    list = list.filter((l) => {
      const a = S.animal.find((x) => x.id === l.animalId);
      if (!a) return false;
      if (state.speciesId && a.speciesId !== state.speciesId) return false;
      if (ids && !ids.includes(a.cageId)) return false;
      return true;
    });
  }
  return list.sort((x, y) => (y.createTime || '').localeCompare(x.createTime || ''));
}

export default {
  title: '饲养日志',
  render(el) {
    const all = filtered();
    const pg = pageInfo(state.page, all.length, SIZE);
    const rows = all.slice(pg.start, pg.end);
    const pageIds = rows.map((l) => l.id);
    const allChecked = pageIds.length > 0 && pageIds.every((id) => state.checked.has(id));

    el.innerHTML = `
      ${pageHead('饲养日志', '全部喂食 / 医疗记录，按时间倒序',
        `<button class="btn ghost" id="lg-foodlib">🍽 食物库</button>`)}
      <div class="card" style="box-shadow:none;padding:12px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:130px;margin:0"><label>类型</label>
            <select id="lg-type">
              <option value="">全部类型</option>
              <option value="feed" ${state.type === 'feed' ? 'selected' : ''}>🍽 喂食</option>
              <option value="medical" ${state.type === 'medical' ? 'selected' : ''}>💉 医疗</option>
            </select></div>
          <div class="field" style="flex:1;min-width:130px;margin:0"><label>爬柜</label>
            <select id="lg-plan">
              <option value="">全部爬柜</option>
              ${listPlans().map((p) => `<option value="${p.id}" ${state.planId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select></div>
          <div class="field" style="flex:1;min-width:130px;margin:0"><label>物种</label>
            <select id="lg-species">
              <option value="">全部物种</option>
              ${[...new Set(S.animal.map((a) => a.speciesId).filter(Boolean))].map((sid) => `<option value="${sid}" ${sid === state.speciesId ? 'selected' : ''}>${esc(speciesName(sid) || sid)}</option>`).join('')}
            </select></div>
          <div class="field sf-field" style="flex:2;min-width:160px;margin:0"><label>搜索</label>
            <div class="sf-wrap">
              <span class="sf-ico">🔍</span>
              <input type="search" id="lg-q" value="${esc(state.q)}" placeholder="个体名称或记录内容">
              <button type="button" class="sf-clear" id="lg-q-clear" title="清空搜索" ${state.q ? '' : 'style="display:none"'}>✕</button>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>记录列表</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <span style="color:var(--muted);font-size:12px">共 ${all.length} 条</span>
            ${pageIds.length ? `<button class="btn ghost sm" id="lg-selall">${allChecked ? '☑ 取消全选' : '☑ 全选'}</button>` : ''}
          </div>
        </div>
        ${state.checked.size ? `<div class="log-batch-bar">
          <span class="lbb-count">已选 ${state.checked.size} 条</span>
          <button class="btn ghost sm" id="lg-batch-del" style="color:var(--danger)">🗑 批量删除</button>
          <button class="btn ghost sm" id="lg-batch-cancel">取消选择</button>
        </div>` : ''}
        ${rows.length ? `<div class="list">
          ${rows.map((l) => {
            const a = S.animal.find((x) => x.id === l.animalId);
            const txt = dataText(l.logType, l.data);
            return `<div class="row" style="cursor:default">
              <input type="checkbox" class="log-check" data-id="${l.id}" ${state.checked.has(l.id) ? 'checked' : ''} title="选择此记录">
              <div class="animal-thumb">${l.logType === 'feed' ? '🍽' : '💉'}</div>
              <div class="row-main">
                <div class="row-title">
                  <span class="log-badge ${TYPE_CLS[l.logType] || ''}">${TYPE_LABEL[l.logType] || l.logType}</span>
                  ${a ? `<a href="#/animal/${a.id}">${esc(a.name)}</a>${a.code ? ` <span style="color:var(--muted);font-weight:400;font-size:12px">${esc(a.code)}</span>` : ''}` : '<span style="color:var(--muted)">个体已删除</span>'}
                </div>
                <div class="row-sub">${esc(l.createTime || '')}${a && a.speciesId ? ' · ' + esc(speciesName(a.speciesId) || '') : ''}${txt ? ' · ' + esc(txt) : ''}</div>
              </div>
              <div class="row-side" style="white-space:nowrap">
                <button class="btn ghost sm" data-edit="${l.id}" title="修改此记录">修改</button>
                <button class="btn ghost sm" data-del="${l.id}" style="color:var(--danger)" title="删除此记录">删除</button>
              </div>
            </div>`;
          }).join('')}
        </div>
        ${pagerHtml(pg.page, all.length, SIZE)}` : emptyTip('📖', '暂无喂食 / 医疗记录')}
      </div>
    `;

    // 食物库按钮（右上角）
    const foodBtn = el.querySelector('#lg-foodlib');
    if (foodBtn) foodBtn.onclick = () => openFoodLibrary(() => this.render(el));

    // 单条修改
    el.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = async () => {
        const l = S.animal_log.find((x) => x.id === b.dataset.edit);
        if (!l) return;
        const a = S.animal.find((x) => x.id === l.animalId);
        const ok = await logFormModal({
          animalId: l.animalId, type: l.logType, log: l,
          speciesId: a ? a.speciesId : '',
        });
        if (ok) { state.checked.delete(l.id); this.render(el); }
      };
    });
    // 单条删除
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const l = S.animal_log.find((x) => x.id === b.dataset.del);
        if (!l) return;
        const a = S.animal.find((x) => x.id === l.animalId);
        const ok = await confirmDialog('删除记录',
          `确定删除${a ? `「${a.name}」` : ''}的这条${TYPE_LABEL[l.logType] || ''}记录？删除后不可恢复。`,
          { okText: '删除', danger: true });
        if (!ok) return;
        await removeLog(l.id);
        state.checked.delete(l.id);
        toast('已删除', 'ok');
        this.render(el);
      };
    });

    el.querySelector('#lg-type').onchange = (e) => { state.type = e.target.value; state.page = 1; state.checked.clear(); this.render(el); };
    el.querySelector('#lg-plan').onchange = (e) => { state.planId = e.target.value; state.page = 1; state.checked.clear(); this.render(el); };
    el.querySelector('#lg-species').onchange = (e) => { state.speciesId = e.target.value; state.page = 1; state.checked.clear(); this.render(el); };
    let t = null;
    el.querySelector('#lg-q').oninput = (e) => { state.q = e.target.value; };
    el.querySelector('#lg-q').onchange = (e) => { state.q = e.target.value; state.page = 1; state.checked.clear(); this.render(el); };
    el.querySelector('#lg-q').onkeydown = (e) => { if (e.key === 'Enter') { state.q = e.target.value; state.page = 1; state.checked.clear(); this.render(el); } };
    // v2.6：清空搜索按钮
    const qClear = el.querySelector('#lg-q-clear');
    if (qClear) qClear.onclick = () => { state.q = ''; state.page = 1; state.checked.clear(); this.render(el); };

    // 单条勾选
    el.querySelectorAll('.log-check').forEach((cb) => {
      cb.onchange = () => {
        if (cb.checked) state.checked.add(cb.dataset.id);
        else state.checked.delete(cb.dataset.id);
        this.render(el);
      };
    });
    // 全选 / 取消全选（当前页）
    const selAll = el.querySelector('#lg-selall');
    if (selAll) selAll.onclick = () => {
      if (allChecked) pageIds.forEach((id) => state.checked.delete(id));
      else pageIds.forEach((id) => state.checked.add(id));
      this.render(el);
    };
    // 批量操作栏
    const batchCancel = el.querySelector('#lg-batch-cancel');
    if (batchCancel) batchCancel.onclick = () => { state.checked.clear(); this.render(el); };
    const batchDel = el.querySelector('#lg-batch-del');
    if (batchDel) batchDel.onclick = async () => {
      const n = state.checked.size;
      const ok = await confirmDialog('批量删除记录', `将删除已选中的 ${n} 条喂食 / 医疗记录，删除后不可恢复。确定删除？`, { okText: '删除', danger: true });
      if (!ok) return;
      for (const id of [...state.checked]) await removeLog(id);
      state.checked.clear();
      toast(`已删除 ${n} 条记录`, 'ok');
      this.render(el);
    };
    bindPager(el, (p) => { state.page = p; state.checked.clear(); this.render(el); });
  },
};
