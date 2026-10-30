// foodlib.js —— 食物库（v3.1）
//   · 从饲养日志页右上角「食物库」按钮打开（弹层，不占独立路由）
//   · 支持增 / 删 / 查（搜索）/ 改
//   · 内置食物：白蟋蟀（睫角守宫）、果泥（睫角守宫）、冻鼠（猪鼻蛇）
//   · 每条食物的「类型」= 适用物种（可空可多选）；为空 = 通用，所有物种都显示
'use strict';

import { esc, runModal, toast, confirmDialog } from './util.js';
import { listSpecies, listFoods, createFood, updateFood, removeFood } from './store.js';

const EMPTY_TEXT = '通用（所有物种）';

function speciesNames(ids) {
  if (!ids || !ids.length) return '通用';
  const sp = listSpecies();
  return ids.map((id) => (sp.find((s) => s.id === id) || {}).name || id).join('、');
}

/* 食物表单弹窗：类型（物种多选，可空）+ 食物名称（不可空）
   保存时先校验：名称为空则提示并保持弹窗打开（不关闭）。 */
async function foodFormModal(food) {
  const editing = !!food;
  const sps = listSpecies();
  const cur = (food && food.speciesId) || [];
  const res = await runModal({
    title: editing ? '编辑食物' : '新增食物',
    bodyHtml: `
      <div class="field" style="margin:0"><label>类型</label>
        <select id="fd-species" multiple data-pk-title="适用物种（可多选）" data-pk-empty-text="${EMPTY_TEXT}">
          ${sps.map((s) => `<option value="${s.id}" ${cur.includes(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
        <div class="hint">不选 = 通用，该食物对所有物种都显示；可多选。</div>
      </div>
      <div class="field" style="margin:12px 0 0"><label>食物<span class="req">*</span></label>
        <input type="text" id="fd-name" placeholder="例如：樱桃蟑螂 / 面包虫 / 钙粉" value="${food ? esc(food.name) : ''}">
      </div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
    mount(mask, close) {
      // 覆盖「保存」按钮：校验不通过则不关闭弹窗
      const saveBtn = [...mask.querySelectorAll('.m-foot .btn')].find((b) => b.textContent === '保存');
      if (saveBtn) {
        saveBtn.onclick = async () => {
          const nameEl = mask.querySelector('#fd-name');
          const spEl = mask.querySelector('#fd-species');
          const name = ((nameEl && nameEl.value) || '').trim();
          if (!name) { toast('食物名称不能为空', 'warn'); return; }
          const speciesId = spEl ? [...spEl.selectedOptions].map((o) => o.value) : [];
          try {
            if (editing) { await updateFood(food.id, { name, speciesId }); toast('已保存', 'ok'); }
            else { await createFood({ name, speciesId }); toast('已创建', 'ok'); }
            close('ok');
          } catch (e) {
            toast(e.message || '保存失败', 'err');
          }
        };
      }
    },
  });
  return res === 'ok';
}

/* 食物库主弹层：列表 + 搜索 + 增删改 */
export async function openFoodLibrary(onChanged) {
  await runModal({
    title: '食物库',
    bodyHtml: `
      <div class="flq">
        <span class="flq-ico">🔍</span>
        <input type="search" id="fl-q" placeholder="搜索食物名称，如「白蟋蟀」" autocomplete="off">
        <button type="button" class="flq-clear" id="fl-q-clear" title="清空搜索" style="display:none">✕</button>
      </div>
      <div class="flq-meta" id="fl-count"></div>
      <div id="fl-list"></div>`,
    buttons: [
      { text: '＋ 新增食物', value: 'add' },
      { text: '关闭', cls: 'ghost', value: null },
    ],
    mount(mask, close) {
      const listBox = mask.querySelector('#fl-list');
      const q = mask.querySelector('#fl-q');
      const qClear = mask.querySelector('#fl-q-clear');
      const countEl = mask.querySelector('#fl-count');

      function render() {
        const kw = (q.value || '').trim().toLowerCase();
        const all = listFoods();
        const rows = all.filter((f) => !kw || (f.name || '').toLowerCase().includes(kw));
        if (countEl) {
          countEl.textContent = kw
            ? `匹配 ${rows.length} / ${all.length} 种食物`
            : `共 ${all.length} 种食物`;
        }
        listBox.innerHTML = rows.length ? `<div class="list">${rows.map((f) => `
          <div class="row" style="cursor:default">
            <div class="animal-thumb" style="font-size:20px">🍽</div>
            <div class="row-main">
              <div class="row-title">${esc(f.name)}${f.isCustom ? '' : ' <span class="st st-ok">内置</span>'}</div>
              <div class="row-sub">类型：${esc(speciesNames(f.speciesId))}</div>
            </div>
            <div class="row-side" style="white-space:nowrap">
              <button class="btn ghost sm" data-edit="${f.id}">修改</button>
              <button class="btn ghost sm" data-del="${f.id}" style="color:var(--danger)">删除</button>
            </div>
          </div>`).join('')}</div>`
          : `<div class="empty-tip"><span class="et-ico">🍽</span>${kw ? '没有匹配的食物' : '暂无食物，点击「新增食物」创建'}</div>`;

        listBox.querySelectorAll('[data-edit]').forEach((b) => {
          b.onclick = async () => {
            const f = listFoods().find((x) => x.id === b.dataset.edit);
            if (!f) return;
            const ok = await foodFormModal(f);
            if (ok) { render(); if (onChanged) onChanged(); }
          };
        });
        listBox.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const f = listFoods().find((x) => x.id === b.dataset.del);
            if (!f) return;
            const ok = await confirmDialog('删除食物', `确定从食物库删除「${f.name}」？已记录的喂食日志不受影响。`, { okText: '删除', danger: true });
            if (!ok) return;
            await removeFood(f.id);
            toast('已删除', 'ok');
            render();
            if (onChanged) onChanged();
          };
        });
      }

      q.oninput = () => { qClear.style.display = q.value ? '' : 'none'; render(); };
      qClear.onclick = () => { q.value = ''; qClear.style.display = 'none'; render(); };

      // 底部「＋ 新增食物」按钮：打开表单弹窗（表单弹窗在食物库之上叠一层）
      const addBtn = [...mask.querySelectorAll('.m-foot .btn')].find((b) => b.textContent.includes('新增食物'));
      if (addBtn) {
        const orig = addBtn.onclick;
        addBtn.onclick = async () => {
          const ok = await foodFormModal(null);
          if (ok) { render(); if (onChanged) onChanged(); }
        };
        void orig;
      }
      render();
    },
  });
}
