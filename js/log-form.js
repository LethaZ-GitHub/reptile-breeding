// log-form.js —— 饲养日志（喂食 / 医疗）新增与修改的共用弹窗（v3.1 抽出）
//   · 个体详情页与「饲养日志」列表页共用，避免两套表单漂移
//   · 编辑模式下沿用原 createTime；新增时取当前时间
'use strict';

import { esc, runModal, toast } from './util.js';
import { LOG_TYPES, listFoods, addLog, updateLog, speciesName, storeWeight, storeLength, dispWeight, dispLength } from './store.js';
import { unitWeight, unitLength } from './settings.js';
import { openFoodLibrary } from './foodlib.js';

function fieldOf(label, inner, req) {
  return `<div class="field"><label>${esc(label)}${req ? '<span class="req">*</span>' : ''}</label>${inner}</div>`;
}

/* 可选食物：通用食物 + 该物种专属食物
   v3.3：speciesId 可传数组（首页批量喂食时多个体可能跨物种） */
function foodOptions(speciesId) {
  const ids = Array.isArray(speciesId) ? speciesId.filter(Boolean) : (speciesId ? [speciesId] : []);
  return listFoods().filter((f) => {
    const sp = f.speciesId;
    if (!sp || !sp.length) return true;                 // 通用食物：所有物种都显示
    if (!ids.length) return true;                        // 未指定物种：显示全部
    return sp.some((s) => ids.includes(s));
  });
}

/* v3.2：喂食表单只保留「食物库」下拉框（去掉冗余的文本输入框）。
   编辑历史记录时，原食物可能已不在食物库中 → 补进选项，避免改其它字段时把食物丢掉。 */
function fillFoodOptions(sel, foods, curFood, keepVal) {
  const names = foods.map((f) => f.name);
  if (curFood && !names.includes(curFood)) names.push(curFood);
  sel.innerHTML = `<option value="">— 从食物库选择 —</option>`
    + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const want = keepVal || curFood || '';
  if (want && names.includes(want)) sel.value = want;
}

/**
 * 打开日志表单弹窗（只填表单，不落库）
 * 供「个体详情页」「饲养日志页」「首页批量喂食」共用。
 * @param {object} o
 * @param {string} o.type 'feed' | 'medical' | 'measure'
 * @param {object} [o.log] 传入则为「修改」模式（回填原值）
 * @param {string|string[]} [o.speciesId] 物种（可传数组，跨物种时取并集）
 * @param {string} [o.title] 自定义标题
 * @returns {Promise<{data:object}|null>} 填写完成返回 data；取消返回 null
 */
export async function logFormDataModal({ type, log = null, speciesId = '', title = '' }) {
  const editing = !!log;
  const cfg = LOG_TYPES[type] || LOG_TYPES.feed;
  const d = (log && log.data) || {};
  const curFood = d.food || '';

  let body = '';
  if (type === 'feed') {
    // v3.2：去掉「食物」文本输入框，只保留食物库下拉（自带「新建食物」入口）
    body = `
      ${fieldOf('食物', `
        <select id="lg-food-pick"></select>
        <div class="hint" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span>食物取自「食物库」</span>
          <button type="button" class="btn ghost sm" id="lg-foodlib-add">＋ 新建食物</button>
        </div>`, true)}
      ${fieldOf('数量', `<input type="text" id="lg-qty" placeholder="例如：3 只 / 5 g" value="${esc(d.qty || '')}">`)}
      ${fieldOf('吃食情况', `<select id="lg-ate">
        ${['吃完', '剩一部分', '拒食'].map((x) => `<option value="${x}"${d.ate === x ? ' selected' : ''}>${x}</option>`).join('')}
      </select>`)}
      ${fieldOf('备注', `<input type="text" id="lg-note" placeholder="可空" value="${esc(d.note || '')}">`)}`;
  } else if (type === 'medical') {
    body = `
      ${fieldOf('症状 / 类型', `<input type="text" id="lg-sym" placeholder="例如：缺钙 / 蜕皮不畅 / 体检" value="${esc(d.symptom || '')}">`)}
      ${fieldOf('处理 / 用药', `<textarea id="lg-treat" placeholder="用药名称、剂量、处理方式">${esc(d.treatment || '')}</textarea>`)}
      ${fieldOf('备注', `<input type="text" id="lg-note" placeholder="可空" value="${esc(d.note || '')}">`)}`;
  } else {
    // measure（体重体长）：与成长记录页共用同一套字段语义
    const w = (d.weight != null && d.weight !== '') ? dispWeight(d.weight) : '';
    const l = (d.length != null && d.length !== '') ? dispLength(d.length) : '';
    body = `
      ${fieldOf(`体重（${unitWeight()}，可空）`, `<input type="number" id="lg-w" min="0" step="0.1" placeholder="可空" value="${w}">`)}
      ${fieldOf(`体长（${unitLength()}，可空）`, `<input type="number" id="lg-l" min="0" step="0.1" placeholder="可空" value="${l}">`)}
      ${fieldOf('备注', `<input type="text" id="lg-note" placeholder="可空" value="${esc(d.note || '')}">`)}
      <div class="hint">录入时间取当前时间，不可手动修改、不支持补录历史。</div>`;
  }

  const res = await runModal({
    title: title || `${editing ? '修改' : '新增'}${cfg.label}记录`,
    bodyHtml: body,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
    mount(mask) {
      if (type !== 'feed') return;
      const sel = mask.querySelector('#lg-food-pick');
      if (!sel) return;
      // v3.2：食物只从「食物库」下拉选择（不再有自由文本输入框）
      fillFoodOptions(sel, foodOptions(speciesId), curFood);
      // 「＋ 新建食物」→ 打开食物库弹层，新增后回填选项
      const addBtn = mask.querySelector('#lg-foodlib-add');
      if (addBtn) {
        addBtn.onclick = async () => {
          const keep = sel.value;
          await openFoodLibrary(() => {
            fillFoodOptions(sel, foodOptions(speciesId), curFood, keep);
          });
          fillFoodOptions(sel, foodOptions(speciesId), curFood, keep);
        };
      }
    },
  });
  if (!res) return null;

  const v = (id) => (document.getElementById(id) || {}).value || '';
  let data = {};
  if (type === 'feed') {
    const food = v('lg-food-pick').trim();
    if (!food) { toast('请选择食物', 'warn'); return null; }
    data = { food, qty: v('lg-qty'), ate: v('lg-ate'), note: v('lg-note') };
  } else if (type === 'medical') {
    data = { symptom: v('lg-sym'), treatment: v('lg-treat'), note: v('lg-note') };
  } else {
    const w = v('lg-w'), l = v('lg-l');
    if (w === '' && l === '') { toast('体重和体长至少填一项', 'warn'); return null; }
    data = { weight: w === '' ? '' : storeWeight(w), length: l === '' ? '' : storeLength(l), note: v('lg-note') };
  }
  return { data };
}

/**
 * 打开日志表单弹窗并直接落库（个体详情页 / 饲养日志页新增与修改共用）
 * @param {object} o
 * @param {string} o.animalId 个体 id
 * @param {string} o.type 'feed' | 'medical' | 'measure'
 * @param {object} [o.log] 传入则为「修改」模式
 * @param {string|string[]} [o.speciesId] 个体所属物种（用于过滤食物库）
 * @returns {Promise<boolean>} 是否保存成功
 */
export async function logFormModal({ animalId, type, log = null, speciesId = '' }) {
  const editing = !!log;
  const r = await logFormDataModal({ type, log, speciesId });
  if (!r) return false;
  try {
    if (editing) { await updateLog(log.id, { data: r.data }); toast('已保存', 'ok'); }
    else { await addLog(animalId, type, r.data); toast('已记录', 'ok'); }
    return true;
  } catch (e) {
    toast(e.message || '保存失败', 'err');
    return false;
  }
}

/**
 * 批量喂食 / 医疗：填一次表单，为每个个体各生成一条独立记录。
 * 供首页「喂养记录」使用——与个体详情页共用同一套表单，字段完全一致。
 * @param {string[]} animalIds 选中的个体 id 列表
 * @param {string} type 'feed' | 'medical'
 * @param {string|string[]} speciesIds 涉及到的物种（食物库过滤用）
 * @returns {Promise<number>} 成功写入的记录条数（0 = 取消）
 */
export async function batchLogFormModal(animalIds, type, speciesIds) {
  const ids = (animalIds || []).filter(Boolean);
  if (!ids.length) return 0;
  const cfg = LOG_TYPES[type] || LOG_TYPES.feed;
  const r = await logFormDataModal({
    type,
    speciesId: speciesIds,
    title: `新增${cfg.label}记录 · ${ids.length} 只个体`,
  });
  if (!r) return 0;
  let n = 0;
  for (const id of ids) {
    try { await addLog(id, type, r.data); n++; }
    catch (e) { toast(e.message || '保存失败', 'err'); }
  }
  return n;
}
