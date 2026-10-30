// pages/species.js —— 物种库管理
'use strict';

import { esc, toast, promptDialog, confirmDialog } from '../util.js';
import { pageHead, emptyTip } from '../ui.js';
import { listSpecies, createSpecies, updateSpecies, removeSpecies, listAnimals } from '../store.js';

export default {
  title: '物种库',
  render(el) {
    el.innerHTML = `${pageHead('物种库', '内置物种不可修改删除；被个体使用的自定义物种禁止删除', `<button class="btn" id="btn-add">＋ 自定义物种</button>`)}
      <div class="card"><div class="list" id="sp-list"></div></div>`;

    function render() {
      const rows = listSpecies();
      el.querySelector('#sp-list').innerHTML = rows.length ? rows.map((s) => {
        const n = listAnimals({ speciesId: s.id }).length;
        return `<div class="row" style="cursor:default">
          <div class="animal-thumb">${s.id === 'sp-hognose' ? '🐍' : s.id === 'sp-crested' ? '🦎' : '🦕'}</div>
          <div class="row-main">
            <div class="row-title">${esc(s.name)} ${s.isCustom ? '<span class="st st-unknown">自定义</span>' : '<span class="st st-ok">内置</span>'}</div>
            <div class="row-sub">个体 ${n} 只</div>
          </div>
          <div class="row-side" style="white-space:nowrap">
            ${s.isCustom ? `<button class="btn ghost sm" data-edit="${s.id}" title="修改物种名称">修改</button>` : ''}
            ${s.isCustom ? `<button class="btn ghost sm" data-del="${s.id}" style="color:var(--danger)">删除</button>` : ''}
          </div>
        </div>`;
      }).join('') : emptyTip('🔬', '暂无物种');

      // 修改物种（仅自定义物种）
      el.querySelectorAll('[data-edit]').forEach((b) => {
        b.onclick = async () => {
          const s = rows.find((x) => x.id === b.dataset.edit);
          if (!s) return;
          const name = await promptDialog('修改物种', '物种名称', { defaultValue: s.name, placeholder: '例如：豹纹守宫' });
          if (!name) return;
          try { await updateSpecies(s.id, { name }); toast('已修改', 'ok'); render(); }
          catch (err) { toast(err.message || '修改失败', 'err'); }
        };
      });
      el.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const s = rows.find((x) => x.id === b.dataset.del);
          if (!s) return;
          const ok = await confirmDialog('删除物种', `确定删除物种「${s.name}」？`, { okText: '删除', danger: true });
          if (!ok) return;
          try { await removeSpecies(s.id); toast('已删除', 'ok'); render(); }
          catch (err) { toast(err.message || '删除失败', 'err'); }
        };
      });
    }
    el.querySelector('#btn-add').onclick = async () => {
      const name = await promptDialog('自定义物种', '物种名称', { placeholder: '例如：豹纹守宫' });
      if (!name) return;
      try { await createSpecies(name); toast('已创建', 'ok'); render(); }
      catch (err) { toast(err.message, 'err'); }
    };
    render();
  },
};
