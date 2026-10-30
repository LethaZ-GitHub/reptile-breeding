// pages/animal-form.js —— 新建 / 编辑 / 克隆 个体表单
'use strict';

import { App } from '../app.js';
import { esc, toast, todayStr, confirmDialog, promptDialog } from '../util.js';
import { pageHead, fieldHtml, sexIco } from '../ui.js';
import {
  listSpecies, listGenes, listTags, createTag, listCages, listPlans,
  allAnimals, getAnimal, getEgg, createAnimal, updateAnimal, cloneAnimal, getCage, animalName,
  storeWeight, storeLength, dispWeight, dispLength, linkEggAnimal, speciesName,
} from '../store.js';
import { unitWeight, unitLength, getSetting } from '../settings.js';

export default {
  title: '个体表单',
  async render(el, params) {
    const mode = params.mode || 'new'; // new | edit | clone
    const src = (mode !== 'new' && params.id) ? getAnimal(params.id) : null;
    if (mode !== 'new' && !src) { el.innerHTML = '<div class="empty-tip">个体不存在</div>'; return; }

    // 孵化预填：从蛋记录带入物种 / 父母本 / 出生日期（孵化日）
    let hatchEgg = null;
    if (mode === 'new' && params.hatch) hatchEgg = getEgg(params.hatch);
    const motherOfHatch = hatchEgg && hatchEgg.motherId ? getAnimal(hatchEgg.motherId) : null;
    const TITLES = { new: hatchEgg ? '新建个体 · 孵化登记' : '新建个体', edit: '编辑个体', clone: '克隆个体' };
    const a = src || (hatchEgg ? {
      speciesId: hatchEgg.speciesId || (motherOfHatch ? motherOfHatch.speciesId : '') || '',
      motherId: hatchEgg.motherId || null,
      fatherId: hatchEgg.fatherId || null,
      birthDate: todayStr(), // 孵化当天作为出生日期
    } : {});
    const sel = {
      geneIds: [...(a.geneIds || [])],
      tagIds: [...(a.tagIds || [])],
      speciesId: a.speciesId || (listSpecies()[0] || {}).id || '',
    };

    el.innerHTML = `
      ${pageHead(TITLES[mode], mode === 'clone' ? '复制基础信息与标签；照片、日志、繁殖、蛋记录不复制'
        : (hatchEgg ? '已自动带入物种、父母本与出生日期（孵化日），补整个体名称即可' : '带 * 为必填项'),
        `<button class="btn ghost" id="btn-back">返回</button>`)}
      <div class="card">
        <div class="form-grid">
          ${fieldHtml('个体名称', `<input type="text" id="f-name" value="${esc(a.name || '')}" placeholder="例如：小绿">`, { req: true, span2: true })}
          ${fieldHtml('物种', `<select id="f-species">${listSpecies().map((s) => `<option value="${s.id}" ${s.id === sel.speciesId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`, { req: true })}
          ${fieldHtml('性别', `<select id="f-sex">
            <option value="male" ${a.sex === 'male' ? 'selected' : ''}>♂ 公</option>
            <option value="female" ${a.sex === 'female' ? 'selected' : ''}>♀ 母</option>
            <option value="unknown" ${(!a.sex || a.sex === 'unknown') ? 'selected' : ''}>未知</option>
          </select>`, { hint: '公个体不记录产蛋' })}
          ${fieldHtml('基因（仅可从基因库选择）', `<div class="multi" id="f-genes"></div>`, { hint: mode === 'edit' && (a.geneIds || []).length > 1 ? '该个体原有多条基因记录，保存后仅保留第一个' : '基因预测按该基因的遗传类型取默认携带状态' })}
          ${fieldHtml('表现（可选）', `<input type="text" id="f-pheno" value="${esc(a.phenotype || '')}" placeholder="例如：黄底奶油、极端红等">`, { hint: '手动填写视觉表现；可空' })}
          ${fieldHtml(`最近体重（${unitWeight()}）`, `<input type="number" id="f-weight" min="0" step="0.1" value="${dispWeight(a.weight)}" placeholder="可空">`)}
          ${fieldHtml(`最近体长（${unitLength()}）`, `<input type="number" id="f-length" min="0" step="0.1" value="${dispLength(a.length)}" placeholder="可空">`)}
          ${fieldHtml('购入日期', `<input type="date" id="f-buydate" value="${(a.buyDate || '').slice(0, 10)}">`)}
          ${fieldHtml('生日 / 出壳日期', `<input type="date" id="f-birth" value="${(a.birthDate || '').slice(0, 10)}">`)}
          ${fieldHtml('所属爬箱', `<select id="f-cage"></select>`, { hint: '一个个体只能绑定一个爬箱' })}
          ${fieldHtml('全局标签', `<div class="multi" id="f-tags"></div>`, { hint: '可多选' })}
          ${fieldHtml('父体', `<select id="f-father"></select>`)}
          ${fieldHtml('母体', `<select id="f-mother"></select>`, { hint: '' })}
          ${fieldHtml('购入价格（元）', `<input type="number" id="f-buyprice" min="0" step="0.01" value="${a.buyPrice ?? ''}" placeholder="可空，计入支出">`)}
          ${fieldHtml('状态', `<select id="f-status">
            <option value="normal" ${(!a.status || a.status === 'normal') ? 'selected' : ''}>正常</option>
            <option value="sold" ${a.status === 'sold' ? 'selected' : ''}>已售出</option>
            <option value="dead" ${a.status === 'dead' ? 'selected' : ''}>已离世</option>
            <option value="gift" ${a.status === 'gift' ? 'selected' : ''}>已赠送</option>
          </select>`, { hint: '' })}
          <div id="sold-box" style="display:${a.status === 'sold' ? 'contents' : 'none'}">
            ${fieldHtml('售出金额（元）', `<input type="number" id="f-soldprice" min="0" step="0.01" value="${a.soldPrice ?? ''}" placeholder="计入收入">`)}
            ${fieldHtml('售出日期', `<input type="date" id="f-solddate" value="${(a.soldDate || '').slice(0, 10)}">`)}
          </div>
          ${fieldHtml('铲屎官', `<input type="text" id="f-keeper" value="${esc(a.keeper != null ? a.keeper : (getSetting('keeperName') || ''))}" placeholder="默认取设置中的铲屎官名，可修改">`, { span2: true })}
          ${fieldHtml('备注', `<textarea id="f-note" placeholder="性格、来源、健康备注…">${esc(a.note || '')}</textarea>`, { span2: true })}
        </div>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn" id="btn-save">${mode === 'new' ? '创建个体' : '保存修改'}</button>
          <button class="btn ghost" id="btn-cancel">取消</button>
        </div>
      </div>
    `;

    /* ---------- 级联下拉 ---------- */
    const cageSel = el.querySelector('#f-cage');
    function fillCages() {
      const rows = [];
      listPlans().forEach((p) => {
        listCages(p.id).forEach((c) => {
          rows.push(`<option value="${c.id}" ${c.id === a.cageId ? 'selected' : ''}>${esc(p.name)} · ${esc(c.sizeType)}</option>`);
        });
      });
      cageSel.innerHTML = `<option value="">不绑定</option>` + rows.join('');
    }
    // 父母本按当前物种过滤（跨物种不配对）；已选但不在该物种下的保留在首位，避免 silently 丢失
    function fillParents() {
      const sameSp = (x) => x.speciesId === sel.speciesId;
      const opts = (sex, curId) => {
        const list = allAnimals().filter((x) => x.id !== a.id && x.sex === sex && sameSp(x));
        const cur = curId ? allAnimals().find((x) => x.id === curId) : null;
        const head = (cur && !sameSp(cur)) ? `<option value="${cur.id}" selected>${esc(cur.name)}（${esc(speciesName(cur.speciesId) || '其他物种')}）</option>` : '';
        const body = list.map((x) => `<option value="${x.id}" ${x.id === curId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
        return `<option value="">未填写</option>` + head + body;
      };
      el.querySelector('#f-mother').innerHTML = opts('female', a.motherId);
      el.querySelector('#f-father').innerHTML = opts('male', a.fatherId);
    }
    fillCages(); fillParents();

    /* ---------- 基因（单选） ---------- */
    const geneBox = el.querySelector('#f-genes');
    function renderGenes() {
      const cur = sel.geneIds[0] || '';
      // v2.0 起多基因选育已取消：可选列表排除该类型（当前个体已选的旧多基因基因仍保留可展示）
      const lib = listGenes(sel.speciesId).filter((g) => g.type !== 'polygenic');
      // 编辑态：当前基因（含旧版多基因等存量类型）始终保留在列表首位，避免莫名丢失
      const curGene = cur ? listGenes().find((g) => g.id === cur) : null;
      const all = (curGene && !lib.some((g) => g.id === cur)) ? [curGene, ...lib] : lib;
      geneBox.innerHTML = `<select id="f-gene-sel" style="width:100%">
        <option value="">未选择基因</option>
        ${all.map((g) => `<option value="${g.id}" ${g.id === cur ? 'selected' : ''} ${g.isInvalid ? 'disabled' : ''}>${esc(g.name)}${g.isInvalid ? '（已失效）' : ''}</option>`).join('')}
      </select>`;
      geneBox.querySelector('#f-gene-sel').onchange = (e) => {
        sel.geneIds = e.target.value ? [e.target.value] : [];
        renderGenes();
      };
    }
    renderGenes();

    /* ---------- 标签多选 ---------- */
    const tagBox = el.querySelector('#f-tags');
    function renderTags() {
      const chips = sel.tagIds.map((tid) => {
        const t = listTags().find((x) => x.id === tid);
        return t ? `<span class="chip">${esc(t.name)}<button data-tag="${t.id}">✕</button></span>` : '';
      }).join('');
      const opts = listTags().filter((t) => !sel.tagIds.includes(t.id));
      tagBox.innerHTML = chips + `<select id="f-tag-add"><option value="">＋ 选择标签…</option>${opts.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}<option value="__new__">＋ 新建标签…</option></select>`;
      tagBox.querySelectorAll('button[data-tag]').forEach((b) => {
        b.onclick = () => { sel.tagIds = sel.tagIds.filter((x) => x !== b.dataset.tag); renderTags(); };
      });
      const add = tagBox.querySelector('#f-tag-add');
      if (add) add.onchange = async () => {
        if (add.value === '__new__') {
          const name = await promptDialog('新建标签', '标签名称', { placeholder: '例如：高白' });
          if (!name) { renderTags(); return; }
          try { const t = await createTag(name, '#2e9e6b'); sel.tagIds.push(t.id); }
          catch (e) { toast(e.message, 'err'); }
        } else if (add.value) {
          sel.tagIds.push(add.value);
        }
        renderTags();
      };
    }
    renderTags();

    /* ---------- 交互 ---------- */
    el.querySelector('#f-species').onchange = async (e) => {
      const v = e.target.value;
      if (v !== sel.speciesId) {
        if (sel.geneIds.length) {
          const ok = await confirmDialog('切换物种', '基因列表按物种划分，切换后将清空已选基因。继续？', { okText: '清空并切换', danger: true });
          if (!ok) { e.target.value = sel.speciesId; return; }
          sel.geneIds = [];
        }
        sel.speciesId = v;
        renderGenes();
        fillParents(); // 父母本跟随物种重新过滤
      }
    };
    el.querySelector('#f-status').onchange = (e) => {
      el.querySelector('#sold-box').style.display = e.target.value === 'sold' ? 'contents' : 'none';
    };
    el.querySelector('#btn-back').onclick = () => history.back();
    el.querySelector('#btn-cancel').onclick = () => history.back();

    el.querySelector('#btn-save').onclick = async () => {
      const speciesId = el.querySelector('#f-species').value;
      if (!speciesId) { toast('请选择物种', 'warn'); return; }
      const name = el.querySelector('#f-name').value.trim();
      const data = {
        name, speciesId,
        sex: el.querySelector('#f-sex').value,
        keeper: el.querySelector('#f-keeper').value.trim(),
        tagIds: sel.tagIds,
        geneIds: sel.geneIds.slice(0, 1), // 基因单选
        phenotype: el.querySelector('#f-pheno').value.trim(),
        buyDate: el.querySelector('#f-buydate').value || '',
        buyPrice: el.querySelector('#f-buyprice').value === '' ? null : Number(el.querySelector('#f-buyprice').value),
        birthDate: el.querySelector('#f-birth').value || '',
        note: el.querySelector('#f-note').value.trim(),
        status: el.querySelector('#f-status').value,
        soldPrice: el.querySelector('#f-status').value === 'sold' && el.querySelector('#f-soldprice').value !== '' ? Number(el.querySelector('#f-soldprice').value) : (el.querySelector('#f-status').value === 'sold' ? null : undefined),
        soldDate: el.querySelector('#f-status').value === 'sold' ? (el.querySelector('#f-solddate').value || todayStr()) : undefined,
        weight: storeWeight(el.querySelector('#f-weight').value),
        length: storeLength(el.querySelector('#f-length').value),
        cageId: el.querySelector('#f-cage').value || null,
        motherId: el.querySelector('#f-mother').value || null,
        fatherId: el.querySelector('#f-father').value || null,
      };
      try {
        if (mode === 'new') {
          const row = await createAnimal(data);
          if (hatchEgg) {
            // 孵化登记：自动与蛋记录建立双向关联
            await linkEggAnimal(hatchEgg.id, row.id);
            toast('个体已创建，已关联蛋记录', 'ok');
          } else {
            toast('个体已创建', 'ok');
          }
          App.go('#/animal/' + row.id);
        } else if (mode === 'edit') {
          await updateAnimal(a.id, data);
          toast('已保存', 'ok');
          App.refresh();
        } else {
          const row = await cloneAnimal(a.id);
          await updateAnimal(row.id, data);
          toast('克隆完成，可继续修改', 'ok');
          App.go('#/animals');
        }
      } catch (err) {
        toast(err.message || '保存失败', 'err');
      }
    };
  },
};
