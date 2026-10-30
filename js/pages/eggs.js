// pages/eggs.js —— 蛋管理列表 / 蛋归档
'use strict';

import { App } from '../app.js';
import { esc, toast, todayStr, daysBetween, runModal, addDays } from '../util.js';
import { pageHead, emptyTip, eggStatusBadge, segHtml } from '../ui.js';
import { HATCH_TEMP_DAYS } from '../schema.js';
import { listEggs, EGG_STATUS, listAnimals, createEgg, updateEgg, animalName, listSpecies, eggUnlinked, linkedAnimalBrief, animalGeneStateText } from '../store.js';

/* 父母本选项/展示文本：名称（编号）· 基因 */
function parentBrief(a) {
  if (!a) return '';
  const code = a.code ? `（${a.code}）` : '';
  const gene = animalGeneStateText(a);
  return `${a.name}${code}${gene ? ' · ' + gene : ''}`;
}

export default {
  title: '蛋管理',
  render(el, params) {
    const tab = params.tab || 'active';
    const state = { status: '', motherId: '', page: 1 };
    const PAGE = 15;

    el.innerHTML = `
      ${pageHead(tab === 'archived' ? '蛋归档' : '蛋管理', tab === 'archived' ? '已归档 / 报废 / 已孵化的蛋' : '每颗蛋独立档案，跟踪破壳周期',
        `<button class="btn" id="btn-add">＋ 记录产蛋</button>
         <button class="btn ghost" id="btn-tab">${tab === 'archived' ? '进行中的蛋' : '已归档'}</button>`)}
      <div class="card">
        <div class="seg" id="f-status">${segHtml([{ value: '', label: '全部状态' }, ...Object.entries(EGG_STATUS).map(([v, s]) => ({ value: v, label: s.label }))], '', 'status')}</div>
        <div class="search-box"><select id="f-mother">
          <option value="">全部母本</option>
          ${listAnimals().filter((a) => a.sex === 'female').map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
        </select></div>
        <div class="egg-grid" id="egg-grid"></div>
        <div id="pager"></div>
      </div>
    `;

    el.querySelector('#btn-tab').onclick = () => App.go(tab === 'archived' ? '#/eggs' : '#/eggs/archive');
    el.querySelector('#btn-add').onclick = () => addEggFlow(async () => renderList());

    function renderList() {
      let rows = listEggs({ archived: tab === 'archived' });
      if (state.status) rows = rows.filter((e) => e.status === state.status);
      if (state.motherId) rows = rows.filter((e) => e.motherId === state.motherId);
      const start = (state.page - 1) * PAGE;
      const page = rows.slice(start, start + PAGE);
      const grid = el.querySelector('#egg-grid');
      grid.innerHTML = page.length ? page.map((e) => {
        const left = e.expectHatchDate ? daysBetween(todayStr(), e.expectHatchDate) : null;
        const unlinked = eggUnlinked(e);
        const linked = linkedAnimalBrief(e);
        return `<div class="egg-card" data-id="${e.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="eg-id">${esc(e.code || '')} · ${esc(e.layDate || '未知日期')}</span>
            <span style="display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap">${eggStatusBadge(e)}
              ${unlinked ? '<span class="st st-unknown" title="已孵化但未登记关联个体，点击去关联">⚠️ 未关联个体</span>' : ''}
              ${linked ? `<span class="egg-st hatched" title="已关联孵化个体">🦎 ${esc(linked.animal.code || linked.animal.name)}</span>` : ''}
            </span>
          </div>
          <div class="eg-meta">
            母本：${esc(parentBrief(listAnimals().find((a) => a.id === e.motherId)) || animalName(e.motherId) || '—')}<br>
            ${e.fatherId ? `父本：${esc(parentBrief(listAnimals().find((a) => a.id === e.fatherId)) || animalName(e.fatherId) || '—')}<br>` : ''}
            预计破壳：${esc(e.expectHatchDate || '—')}${e.temp != null ? `（${e.temp}℃）` : ''}${left != null && e.status === 'fertile' ? (left < 0 ? ` <span class="countdown overdue">(${-left}天前)</span>` : left === 0 ? ' <span class="countdown soon">(今天)</span>' : ` (剩${left}天)`) : ''}
            ${linked ? `<br>关联个体：<a href="#/animal/${linked.animal.id}">${esc(linked.animal.name)}</a> · ${esc(linked.animal.code || '')} · ${esc(linked.geneText)}` : ''}
            ${e.isArchived ? `<br>归档原因：${e.archiveReason === 'auto-dead' ? '报废' : e.archiveReason === 'manual' ? '手动归档' : e.archiveReason === 'hatched' ? '已孵化' : esc(e.archiveReason || '')}` : ''}
          </div>
        </div>`;
      }).join('') : emptyTip(tab === 'archived' ? '📦' : '🥚', tab === 'archived' ? '没有已归档的蛋' : '暂无蛋记录');
      grid.querySelectorAll('.egg-card').forEach((c) => { c.onclick = () => App.go('#/egg/' + c.dataset.id); });
      const pager = el.querySelector('#pager');
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      pager.innerHTML = rows.length > PAGE
        ? `<div class="pager"><button ${state.page <= 1 ? 'disabled' : ''} data-p="prev">‹ 上一页</button><span>第 ${state.page}/${pages} 页 · 共 ${rows.length} 颗</span><button ${state.page >= pages ? 'disabled' : ''} data-p="next">下一页 ›</button></div>`
        : `<div class="pager"><span>共 ${rows.length} 颗</span></div>`;
      pager.querySelectorAll('button').forEach((b) => {
        b.onclick = () => { state.page += b.dataset.p === 'prev' ? -1 : 1; renderList(); };
      });
    }

    el.querySelector('#f-status').addEventListener('click', (e) => {
      const item = e.target.closest('.seg-item');
      if (!item) return;
      el.querySelectorAll('#f-status .seg-item').forEach((x) => x.classList.remove('active'));
      item.classList.add('active');
      state.status = item.dataset.status; state.page = 1;
      renderList();
    });
    el.querySelector('#f-mother').onchange = (e) => { state.motherId = e.target.value; state.page = 1; renderList(); };

    renderList();
  },
};

/* ---------- 记录产蛋两步流程：先选物种 → 再填表单（父母本仅显示该物种） ---------- */
async function addEggFlow(done) {
  // 第一步：按物种筛选
  const species = listSpecies();
  const picked = await runModal({
    title: '选择物种',
    bodyHtml: `
      <div class="hint" style="margin-bottom:10px">先选择要记录产蛋的物种，随后母本 / 父本仅显示该物种的个体。</div>
      <div class="pick-list" style="max-height:50vh">
        ${species.map((s) => `
          <div class="pick-row" data-id="${s.id}">
            <span class="pr-name">${esc(s.name)}</span>
            <span class="pr-sub">${listAnimals({ speciesId: s.id }).filter((a) => a.sex === 'female' || a.sex === 'unknown').length} 只可作母本</span>
          </div>`).join('') || '<div class="hint">暂无物种，请先在物种库添加</div>'}
      </div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }],
    mount: (mask, close) => {
      mask.querySelectorAll('.pick-row').forEach((r) => { r.onclick = () => close(r.dataset.id); });
    },
  });
  if (!picked) return;
  const spName = species.find((s) => s.id === picked)?.name || '';
  await eggFormModal(null, picked, spName, done);
}

// 蛋表单（新建 / 编辑共用）：egg 为 null 时新建，传入蛋对象时编辑
export async function eggFormModal(egg, speciesId, speciesName, done) {
  const editing = !!egg;
  const mothers = listAnimals({ speciesId }).filter((a) => a.sex === 'female' || a.sex === 'unknown');
  const fathers = listAnimals({ speciesId }).filter((a) => a.sex === 'male' || a.sex === 'unknown');
  const res = await runModal({
    title: `${editing ? '编辑蛋' : '记录产蛋'} · ${speciesName}`,
    bodyHtml: `
      ${mothers.length ? '' : '<div class="hint" style="margin-bottom:10px;color:var(--warn)">该物种下暂无母本（母 / 性别未知）个体，请先到个体列表维护。</div>'}
      <div class="field"><label>母本<span class="req">*</span></label><select id="eg-mother"><option value="">选择母本</option>${mothers.map((a) => `<option value="${a.id}" ${editing && egg.motherId === a.id ? 'selected' : ''}>${esc(parentBrief(a))}${a.sex === 'unknown' ? '（性别未知）' : ''}</option>`).join('')}</select></div>
      <div class="field"><label>父本</label><select id="eg-father"><option value="">未填写</option>${fathers.map((a) => `<option value="${a.id}" ${editing && egg.fatherId === a.id ? 'selected' : ''}>${esc(parentBrief(a))}</option>`).join('')}</select></div>
      <div class="field"><label>产蛋日期</label><input type="date" id="eg-lay" value="${editing ? esc(egg.layDate || '') : todayStr()}"></div>
      <div class="field"><label>蛋状态</label><select id="eg-status">${Object.entries(EGG_STATUS).filter(([k]) => !['hatched', 'dead'].includes(k) || (editing && egg.status === k)).map(([v, s]) => `<option value="${v}" ${((editing ? egg.status : 'fertile') === v) ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div class="field"><label>孵化温度（℃）</label><input type="number" id="eg-temp" min="10" max="35" step="0.5" value="${editing && egg.temp != null ? egg.temp : ''}" placeholder="例如 22 / 23 / 24 / 25"><div class="hint" id="eg-temp-hint">22℃→90天、23℃→80天、24℃→70天、25℃→60天 自动计算破壳日；其他温度请手动填写</div></div>
        <div class="field"><label>预计破壳日期</label><input type="date" id="eg-hatch" value="${editing ? esc(egg.expectHatchDate || '') : ''}"><div class="hint">受精蛋填写后自动生成首页破壳待办；归档报废会自动取消待办</div></div>
        ${editing ? '' : '<div class="field"><label>产蛋数（颗）</label><input type="number" id="eg-count" value="1" min="1" max="30"><div class="hint">一窝多蛋一次录入，备注自动标注「一窝第 N 颗」</div></div>'}
        <div class="field"><label>备注</label><input type="text" id="eg-note" value="${editing ? esc(egg.note || '') : ''}" placeholder="例如：一窝第 1 颗"></div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
    mount: (mask) => {
      const temp = mask.querySelector('#eg-temp'), hatch = mask.querySelector('#eg-hatch'), lay = mask.querySelector('#eg-lay'), hint = mask.querySelector('#eg-temp-hint');
      const recalc = () => {
        const t = Number(temp.value);
        const days = HATCH_TEMP_DAYS[t];
        if (days) {
          hatch.value = addDays(lay.value || todayStr(), days);
          hint.textContent = `已按 ${t}℃ × ${days} 天自动计算，可手动修改`;
        } else {
          hint.textContent = '22℃→90天、23℃→80天、24℃→70天、25℃→60天 自动计算破壳日；其他温度请手动填写';
        }
      };
      temp.oninput = recalc;
      lay.onchange = recalc;
    },
  });
  if (!res) return;
  const v = (id) => (document.getElementById(id) || {}).value || '';
  if (!v('eg-mother')) { toast('请选择母本', 'warn'); return; }
  const eggData = {
    motherId: v('eg-mother'), fatherId: v('eg-father') || null,
    status: v('eg-status'), layDate: v('eg-lay') || todayStr(),
    temp: v('eg-temp') === '' ? null : Number(v('eg-temp')),
    expectHatchDate: v('eg-hatch'),
    note: v('eg-note'),
  };
  if (editing) {
    await updateEgg(egg.id, eggData);
    toast('蛋记录已更新', 'ok');
  } else {
    const count = Math.min(30, Math.max(1, +v('eg-count') || 1));
    for (let i = 0; i < count; i++) {
      await createEgg({
        ...eggData,
        note: count > 1 ? (eggData.note ? `${eggData.note}（第 ${i + 1} 颗）` : `一窝第 ${i + 1} 颗`) : eggData.note,
      });
    }
    toast(`已记录 ${count} 颗蛋`, 'ok');
  }
  if (done) done();
}
