// pages/pairings.js —— 配对记录：记录配对时间与配对对象
'use strict';

import { esc, toast, todayStr, confirmDialog, runModal } from '../util.js';
import { pageHead, emptyTip, segHtml, sexIco } from '../ui.js';
import {
  listPairings, createPairing, updatePairing, removePairing, PAIR_RESULTS,
  allAnimals, animalName, speciesName, listSpecies, getAnimal, animalGeneStateText,
} from '../store.js';

/* 父母本下拉选项文本（v2.7：与蛋记录下拉统一为「名称（编号）· 基因」） */
const parentBrief = (a) => {
  if (!a) return '';
  const code = a.code ? `（${a.code}）` : '';
  const gene = animalGeneStateText(a);
  return `${a.name}${code}${gene ? ' · ' + gene : ''}`;
};

/* ---------- 配对结果登记（v2.6：待办「查看关联」与完成时共用） ----------
   展示该条配对记录的时间 / 物种 / 父母本（均不可修改），由用户确认配对结果与备注；
   mode='complete'（默认）：按钮「保存并完成」，调用方随后完成待办；
   mode='view'：按钮「确定」，仅把结果与备注同步回配对记录。
   返回 { result, note } 或 null（用户取消）。 */
export async function pairResultModal(pairing, { mode = 'complete' } = {}) {
  if (!pairing) return null;
  const parts = (pairing.participants || []).map((id) => getAnimal(id)).filter(Boolean);
  const nameList = (list) => list.length
    ? list.map((a) => `${esc(a.name)} ${sexIco(a.sex)}`).join('、')
    : '—';
  const females = parts.filter((a) => a.sex === 'female');
  const males = parts.filter((a) => a.sex === 'male');
  const others = parts.filter((a) => a.sex !== 'female' && a.sex !== 'male');
  const spNames = [...new Set(parts.map((a) => speciesName(a.speciesId)).filter(Boolean))];
  const isView = mode === 'view';
  const res = await runModal({
    title: isView ? '配对记录 · 产卵检查' : '登记配对结果',
    bodyHtml: `
      <div class="hint" style="margin-bottom:10px">配对日期 ${esc(pairing.pairDate || '—')}（时间与父母本信息不可修改）</div>
      <div class="cage-preview" style="margin-bottom:12px">
        <div class="pv-row"><span class="k">物种</span><span>${spNames.length ? spNames.map(esc).join('、') : '—'}</span></div>
        <div class="pv-row"><span class="k">母本</span><span>${nameList(females)}</span></div>
        <div class="pv-row"><span class="k">父本</span><span>${nameList(males)}</span></div>
        ${others.length ? `<div class="pv-row"><span class="k">其他参与</span><span>${nameList(others)}</span></div>` : ''}
      </div>
      <div class="field"><label>配对结果<span class="req">*</span></label><select id="pr-result">
        ${Object.entries(PAIR_RESULTS).map(([v, r]) => `<option value="${v}" ${pairing.result === v ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select></div>
      <div class="field"><label>备注</label><input type="text" id="pr-note" value="${esc(pairing.note || '')}" placeholder="例如：交配行为观察、温度情况"></div>
      <div class="hint">${isView ? '点击「确定」后同步到该配对记录' : '保存后同步到该配对记录，并完成本待办'}</div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: isView ? '确定' : '保存并完成', value: 'ok' }],
  });
  if (!res) return null;
  return {
    result: (document.getElementById('pr-result') || {}).value || 'pending',
    note: ((document.getElementById('pr-note') || {}).value || '').trim(),
  };
}

export default {
  title: '配对记录',
  render(el) {
    const state = { q: '', speciesId: '' };

    el.innerHTML = `
      ${pageHead('配对记录', '记录每次配对的日期、对象与结果',
        `<button class="btn" id="btn-add">＋ 新增配对</button>`)}
      <div class="card">
        <div class="search-box">
          <input type="text" id="f-q" placeholder="搜索个体名称 / 备注…">
        </div>
        <div class="seg" id="f-species"></div>
        <div class="list list-grid" id="pair-list"></div>
      </div>
    `;

    const spSeg = el.querySelector('#f-species');
    const speciesOpts = [{ value: '', label: '全部物种' }, ...listSpecies().map((s) => ({ value: s.id, label: s.name }))];
    spSeg.innerHTML = segHtml(speciesOpts, '', 'species');

    el.querySelector('#btn-add').onclick = () => pairModal(null);
    el.querySelector('#f-q').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });
    spSeg.addEventListener('click', (e) => {
      const item = e.target.closest('.seg-item');
      if (!item) return;
      state.speciesId = item.dataset.species;
      spSeg.querySelectorAll('.seg-item').forEach((x) => x.classList.remove('active'));
      item.classList.add('active');
      renderList();
    });

    function renderList() {
      const kw = state.q.trim().toLowerCase();
      const rows = listPairings().filter((p) => {
        if (state.speciesId) {
          const hit = (p.participants || []).some((id) => {
            const a = allAnimals().find((x) => x.id === id);
            return a && a.speciesId === state.speciesId;
          });
          if (!hit) return false;
        }
        if (kw) {
          const names = (p.participants || []).map((id) => animalName(id)).join(' ');
          if (!`${names} ${p.note || ''}`.toLowerCase().includes(kw)) return false;
        }
        return true;
      });
      const listEl = el.querySelector('#pair-list');
      listEl.innerHTML = rows.length ? rows.map((p) => {
        const res = PAIR_RESULTS[p.result] || PAIR_RESULTS.pending;
        const partners = (p.participants || []).map((id) =>
          `<a href="#/animal/${id}">${esc(animalName(id) || '已删除个体')}</a>`).join(' ＋ ');
        return `<div class="row" data-id="${p.id}">
          <div class="animal-thumb">💞</div>
          <div class="row-main">
            <div class="row-title">${partners} <span class="st ${res.cls}">${res.label}</span></div>
            <div class="row-sub">配对日期 ${esc(p.pairDate || '—')}${p.note ? ` · ${esc(p.note)}` : ''}</div>
          </div>
          <div class="row-side" style="white-space:nowrap">
            <button class="btn ghost sm" data-edit="${p.id}">编辑</button>
            <button class="btn ghost sm" data-del="${p.id}" style="color:var(--danger)">删</button>
          </div>
        </div>`;
      }).join('') : emptyTip('💞', '还没有配对记录，点击右上角「新增配对」开始');

      listEl.querySelectorAll('[data-edit]').forEach((b) => {
        b.onclick = (e) => { e.stopPropagation(); pairModal(rows.find((p) => p.id === b.dataset.edit)); };
      });
      listEl.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async (e) => {
          e.stopPropagation();
          const ok = await confirmDialog('删除配对记录', '删除后不可恢复。确定删除？', { okText: '删除', danger: true });
          if (!ok) return;
          await removePairing(b.dataset.del);
          toast('已删除', 'ok');
          renderList();
        };
      });
    }

    /* ---------- 新增 / 编辑配对（v2.6：物种下拉 + 母本 / 父本按物种与性别过滤） ---------- */
    async function pairModal(p) {
      const editing = !!p;
      const animals = allAnimals().filter((a) => !a.isArchived);
      const speciesList = listSpecies();
      // 编辑态预选：母本 = 第一个母性参与者，父本 = 第一个雄性参与者
      const oldParts = editing ? (p.participants || []).map((id) => allAnimals().find((x) => x.id === id)).filter(Boolean) : [];
      const preMother = (oldParts.find((a) => a.sex === 'female') || {}).id || '';
      const preFather = (oldParts.find((a) => a.sex === 'male') || {}).id || '';
      const preSpecies = (oldParts[0] || {}).speciesId || '';
      // 物种默认值：编辑取原记录物种；新建取第一个含可用个体的物种，否则第一个物种
      const spWithAnimals = speciesList.find((s) => animals.some((a) => a.speciesId === s.id));
      let speciesId = preSpecies || (spWithAnimals || speciesList[0] || {}).id || '';
      let motherId = preMother, fatherId = preFather;
      // 旧版多方配对记录：超出母/父各一个的部分，保存时不再保留
      const extraN = Math.max(0, oldParts.length - (preMother ? 1 : 0) - (preFather ? 1 : 0));

      const res = await runModal({
        title: editing ? '编辑配对记录' : '新增配对记录',
        bodyHtml: `
          <div class="field"><label>配对日期<span class="req">*</span></label><input type="date" id="pr-date" value="${editing ? (p.pairDate || '') : todayStr()}"></div>
          <div class="field"><label>物种<span class="req">*</span></label><select id="pr-species">
            ${speciesList.map((s) => `<option value="${s.id}" ${s.id === speciesId ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || '<option value="">尚未创建物种</option>'}
          </select></div>
          <div class="field"><label>母本<span class="req">*</span></label><select id="pr-mother"></select></div>
          <div class="field"><label>父本<span class="req">*</span></label><select id="pr-father"></select></div>
          <div class="field"><label>配对结果</label><select id="pr-result">
            ${Object.entries(PAIR_RESULTS).map(([v, r]) => `<option value="${v}" ${editing ? (p.result === v ? 'selected' : '') : (v === 'pending' ? 'selected' : '')}>${r.label}</option>`).join('')}
          </select></div>
          <div class="field"><label>备注</label><input type="text" id="pr-note" value="${editing ? esc(p.note || '') : ''}" placeholder="例如：交配行为观察、温度情况"></div>
          ${extraN ? `<div class="warn-box">原记录含 ${oldParts.length} 个配对对象；新版按「母本 / 父本」各一个保存，其中 ${extraN} 个其他对象保存后不再保留。</div>` : ''}
          <div class="hint" id="pr-sp-hint"></div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
        mount(mask) {
          const motherSel = mask.querySelector('#pr-mother');
          const fatherSel = mask.querySelector('#pr-father');
          const hint = mask.querySelector('#pr-sp-hint');
          const optsOf = (sex, curId) => {
            const list = animals.filter((a) => a.speciesId === speciesId && a.sex === sex);
            const body = list.map((a) => `<option value="${a.id}" ${a.id === curId ? 'selected' : ''}>${esc(parentBrief(a))}</option>`).join('');
            return `<option value="">${list.length ? '未选择' : '暂无可用个体'}</option>` + body;
          };
          const fillParents = () => {
            // 切换物种后，不属于新物种的预选值清空
            if (motherId && !animals.some((a) => a.id === motherId && a.speciesId === speciesId)) motherId = '';
            if (fatherId && !animals.some((a) => a.id === fatherId && a.speciesId === speciesId)) fatherId = '';
            motherSel.innerHTML = optsOf('female', motherId);
            fatherSel.innerHTML = optsOf('male', fatherId);
            const nF = animals.filter((a) => a.speciesId === speciesId && a.sex === 'female').length;
            const nM = animals.filter((a) => a.speciesId === speciesId && a.sex === 'male').length;
            hint.textContent = `当前物种可选母本 ${nF} 只 / 父本 ${nM} 只；保存后自动为母本生成产卵检查待办（+20 天）。`;
          };
          fillParents();
          mask.querySelector('#pr-species').onchange = (e) => { speciesId = e.target.value; fillParents(); };
          motherSel.onchange = (e) => { motherId = e.target.value; };
          fatherSel.onchange = (e) => { fatherId = e.target.value; };
        },
      });
      if (!res) return;

      const ids = [motherId, fatherId].filter(Boolean);
      if (ids.length < 2) { toast('请选择母本和父本', 'warn'); return; }
      const data = {
        participants: ids,
        pairDate: (document.getElementById('pr-date') || {}).value || todayStr(),
        result: (document.getElementById('pr-result') || {}).value || 'pending',
        note: ((document.getElementById('pr-note') || {}).value || '').trim(),
      };
      try {
        if (editing) { await updatePairing(p.id, data); toast('已保存', 'ok'); }
        else {
          await createPairing(data);
          toast('配对记录已创建，已为母本生成产卵检查待办（+20天）', 'ok');
        }
        renderList();
      } catch (err) { toast(err.message, 'err'); }
    }

    renderList();
  },
};
