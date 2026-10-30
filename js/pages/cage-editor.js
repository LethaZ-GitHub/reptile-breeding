// pages/cage-editor.js —— 爬柜布局（文字卡片版：无尺寸参数 / 入住数量不限 / 一行三个爬箱）
'use strict';

import { App } from '../app.js';
import { esc, toast, todayStr, runModal, confirmDialog } from '../util.js';
import { pageHead, emptyTip } from '../ui.js';
import { CLEAN_CYCLES } from '../schema.js';
import {
  getPlan, listCages, createCage, updateCage, removeCage,
  animalsInCage, bindAnimalToCage, cleanDueOf, recentLogsOfCage,
  allAnimals, listSpecies, speciesName, LOG_TYPES,
} from '../store.js';

export default {
  title: '爬柜',
  render(el, params) {
    const plan = getPlan(params.id);
    if (!plan) { el.innerHTML = emptyTip('🏡', '方案不存在'); return; }
    const cap = plan.capacity || 4;
    const cycle = CLEAN_CYCLES[plan.cleanCycle] || CLEAN_CYCLES.month;
    const sexText = (s) => (s === 'male' ? '公' : s === 'female' ? '母' : '未知');

    el.innerHTML = `
      ${pageHead(plan.name, `${cap} 个爬箱 · 清理周期：${cycle.label}`, `
        <button class="btn" id="btn-add-cage">＋ 添加爬箱</button>
        <button class="btn ghost" id="btn-back">返回方案</button>`)}
      <div id="cage-list"></div>`;

    el.querySelector('#btn-back').onclick = () => App.go('#/cages');
    el.querySelector('#btn-add-cage').onclick = () => addCageModal();

    function draw() {
      const cages = listCages(plan.id);
      const box = el.querySelector('#cage-list');
      const rows = cages.map((c, i) => {
        const animals = animalsInCage(c.id);
        const shown = animals.slice(0, 6);
        return `<div class="cage-cell" data-id="${c.id}">
          <div class="cc-no">爬箱 ${i + 1}</div>
          <div class="cc-list">
            ${animals.length
              ? shown.map((a) => `<div class="cc-item"><b>${esc(a.name)}</b><br><span>${esc(a.code || '')}</span></div>`).join('')
              : '<div class="cc-empty">空箱</div>'}
            ${animals.length > shown.length ? `<div class="cc-more">等 ${animals.length} 只…</div>` : ''}
          </div>
        </div>`;
      }).join('');
      box.innerHTML = `<div class="cage-grid">${rows || ''}</div>`
        + (rows ? '' : emptyTip('📦', '还没有爬箱，点击「添加爬箱」开始'))
        + (cages.length >= cap ? `<div class="hint" style="text-align:center;margin-top:10px">已达该爬柜可放爬箱数上限（${cap} 个），可在方案「⚙️ 设置」中调整数量或删除多余爬箱</div>` : '');
      box.querySelectorAll('.cage-cell[data-id]').forEach((cell) => {
        cell.onclick = () => openPreview(cell.dataset.id);
      });
    }

    async function addCageModal() {
      const cages = listCages(plan.id);
      if (cages.length >= cap) {
        toast(`该爬柜最多可放 ${cap} 个爬箱，可在方案「⚙️ 设置」中调整`, 'warn');
        return;
      }
      const res = await runModal({
        title: '添加爬箱',
        bodyHtml: `
          <div class="field"><label>用途分区</label><select id="cg-zone"><option value="adult">成体箱</option><option value="nursery">育苗箱</option></select></div>
          <div class="field"><label>备注</label><input type="text" id="cg-note" placeholder="例如：含加热灯，朝南摆放"></div>
          <div class="hint">当前已用 ${cages.length}/${cap} 个爬箱；箱内入住数量不限</div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '添加', value: 'ok' }],
      });
      if (!res) return;
      const v = (id) => (document.getElementById(id) || {}).value || '';
      await createCage(plan.id, { zone: v('cg-zone') || 'adult', note: v('cg-note') });
      toast('爬箱已添加', 'ok');
      draw();
    }

    async function openPreview(cageId) {
      const c = listCages(plan.id).find((x) => x.id === cageId);
      if (!c) return;
      const idx = listCages(plan.id).findIndex((x) => x.id === cageId) + 1;
      const { due, left } = cleanDueOf(c);
      const logs = recentLogsOfCage(c.id, 3);

      const occCard = (a) => `
        <div class="occ-card" data-aid="${a.id}">
          <button class="occ-x" data-aid="${a.id}" title="移出本箱">✕</button>
          <div class="oc-name">${esc(a.name)}</div>
          <div class="oc-meta">${esc(a.code || '—')} · ${esc(speciesName(a.speciesId) || '')} · ${sexText(a.sex)}</div>
        </div>`;
      const occEmpty = '<div class="occ-empty">空箱，点击「＋ 放入个体」选择个体</div>';

      const res = await runModal({
        title: `爬箱 ${idx}${c.zone === 'nursery' ? ' · 🧬 育苗箱' : ''}`,
        bodyHtml: `
          <div class="cage-preview">
            <div class="pv-row"><span class="k">清理周期</span><span>${cycle.label}（方案级设置，上次清理 ${esc(plan.lastCleanAt || '—')}）</span></div>
            <div class="pv-row"><span class="k">下次清理</span><span>${esc(due)} · <span class="countdown ${left < 0 ? 'overdue' : left <= 3 ? 'soon' : ''}">${left < 0 ? `已逾期 ${-left} 天` : left === 0 ? '今天' : `剩 ${left} 天`}</span></span></div>
            ${c.note ? `<div class="pv-row"><span class="k">备注</span><span>${esc(c.note)}</span></div>` : ''}
            <div class="pv-row"><span class="k">最近记录</span><span>${logs.length ? logs.map((l) => `${(LOG_TYPES[l.logType] || {}).label || ''} ${esc((l.createTime || '').slice(5, 16))}`).join('<br>') : '暂无'}</span></div>
          </div>
          <div class="occ-head">
            <span>箱内个体（<b id="occ-count">${animalsInCage(c.id).length}</b>）</span>
            <button class="btn sm" id="pv-add">＋ 放入个体</button>
          </div>
          <div class="occ-grid" id="occ-grid">
            ${animalsInCage(c.id).map(occCard).join('') || occEmpty}
          </div>
          <div class="hint" style="margin-top:8px">箱内数量不限；点击卡片右上角 ✕ 将个体移出本箱（不会删除个体）</div>`,
        buttons: [
          { text: '关闭', cls: 'ghost', value: null },
          { text: '编辑爬箱', value: 'edit' },
          { text: '删除爬箱', cls: 'danger', value: 'del' },
        ],
        mount: (mask, close) => {
          const grid = mask.querySelector('#occ-grid');
          const countEl = mask.querySelector('#occ-count');
          const refreshOcc = () => {
            const list = animalsInCage(c.id);
            countEl.textContent = String(list.length);
            grid.innerHTML = list.map(occCard).join('') || occEmpty;
            grid.querySelectorAll('.occ-x').forEach((btn) => {
              btn.onclick = async (e) => {
                e.stopPropagation();
                const a = allAnimals().find((x) => x.id === btn.dataset.aid);
                if (!a) return;
                const yes = await confirmDialog('移出爬箱', `确定将「${a.name}」移出本箱吗？个体不会被删除。`, { okText: '移出' });
                if (!yes) return;
                await bindAnimalToCage(a.id, '');
                toast('已移出本箱', 'ok');
                refreshOcc();
                draw();
              };
            });
          };
          refreshOcc();
          mask.querySelector('#pv-add').onclick = async () => {
            close(null); // 先关详情，再开选择弹窗；放入后重开详情
            const n = await openAnimalPicker(c);
            if (n) { draw(); openPreview(c.id); }
          };
        },
      });
      if (res === 'edit') editCageModal(c, idx);
      if (res === 'del') {
        const n = animalsInCage(c.id).length;
        const ok = await confirmDialog('删除爬箱', `确定删除「爬箱 ${idx}」吗？${n ? `\n箱内 ${n} 只个体会解除爬箱绑定。` : ''}`, { okText: '删除', danger: true });
        if (!ok) return;
        await removeCage(c.id);
        toast('已删除');
        draw();
      }
    }

    // 选择个体放入爬箱：已在箱内的不显示；支持物种 / 性别筛选；可多选
    async function openAnimalPicker(cage) {
      const inCage = new Set(animalsInCage(cage.id).map((a) => a.id));
      const st = { sp: '', sex: '' };
      const selected = new Set();
      let bound = 0;
      const res = await runModal({
        title: '选择个体放入爬箱',
        bodyHtml: `
          <div class="pick-filters">
            <div class="field"><label>物种</label><select id="pk-sp">
              <option value="">全部物种</option>
              ${listSpecies().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select></div>
            <div class="field"><label>性别</label><select id="pk-sex">
              <option value="">全部性别</option>
              <option value="male">公</option><option value="female">母</option><option value="unknown">未知</option>
            </select></div>
          </div>
          <div class="pick-list" id="pk-list"></div>
          <div class="hint" id="pk-hint"></div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '放入所选', value: 'ok' }],
        mount: (mask, close) => {
          const listBox = mask.querySelector('#pk-list');
          const hint = mask.querySelector('#pk-hint');
          const okBtn = [...mask.querySelectorAll('.m-foot .btn')].find((b) => b.textContent === '放入所选');
          const render = () => {
            const cand = allAnimals()
              .filter((a) => !inCage.has(a.id)
                && (!st.sp || a.speciesId === st.sp)
                && (!st.sex || (a.sex || 'unknown') === st.sex))
              .sort((x, y) => (x.name || '').localeCompare(y.name || ''));
            listBox.innerHTML = cand.length
              ? cand.map((a) => `
                <div class="pick-item ${selected.has(a.id) ? 'on' : ''}" data-aid="${a.id}">
                  <span class="pi-check">${selected.has(a.id) ? '☑' : '☐'}</span>
                  <span class="pi-name">${esc(a.name)}</span>
                  <span class="pi-meta">${esc(a.code || '—')} · ${esc(speciesName(a.speciesId) || '')} · ${sexText(a.sex)}</span>
                </div>`).join('')
              : '<div class="occ-empty">没有符合筛选条件的个体</div>';
            hint.textContent = `共 ${cand.length} 只可选（已在箱内的个体不显示）`;
            okBtn.textContent = selected.size ? `放入所选（${selected.size}）` : '放入所选';
            listBox.querySelectorAll('.pick-item').forEach((item) => {
              item.onclick = () => {
                const aid = item.dataset.aid;
                if (selected.has(aid)) selected.delete(aid); else selected.add(aid);
                render();
              };
            });
          };
          mask.querySelector('#pk-sp').onchange = (e) => { st.sp = e.target.value; render(); };
          mask.querySelector('#pk-sex').onchange = (e) => { st.sex = e.target.value; render(); };
          okBtn.onclick = async () => {
            if (!selected.size) { toast('请先选择个体', 'warn'); return; }
            const ids = [...selected];
            for (const aid of ids) await bindAnimalToCage(aid, cage.id);
            bound = ids.length;
            toast(`已放入 ${ids.length} 只个体`, 'ok');
            close('ok');
          };
          render();
        },
      });
      draw();
      return bound;
    }

    async function editCageModal(c, idx) {
      const res = await runModal({
        title: `编辑爬箱 ${idx}`,
        bodyHtml: `
          <div class="field"><label>用途分区</label><select id="cg-zone"><option value="adult" ${c.zone === 'adult' ? 'selected' : ''}>成体箱</option><option value="nursery" ${c.zone === 'nursery' ? 'selected' : ''}>育苗箱</option></select></div>
          <div class="field"><label>备注</label><input type="text" id="cg-note" value="${esc(c.note || '')}"></div>
          <div class="hint">清理周期与上次清理时间在爬柜方案「⚙️ 设置」中调整（当前：${cycle.label}）</div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
      });
      if (!res) return;
      const v = (id) => (document.getElementById(id) || {}).value || '';
      await updateCage(c.id, { zone: v('cg-zone') || 'adult', note: v('cg-note') });
      toast('已保存', 'ok');
      draw();
    }

    draw();
  },
};
