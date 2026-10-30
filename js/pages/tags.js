// pages/tags.js —— 标签管理
'use strict';

import { esc, toast, runModal, confirmDialog } from '../util.js';
import { pageHead, emptyTip } from '../ui.js';
import { listTags, createTag, updateTag, removeTag, listAnimals } from '../store.js';

const PRESETS = ['#2e9e6b', '#e8912d', '#5b8fc9', '#c95f6e', '#9a6fc9', '#6bb5a8', '#8a8f4b', '#d0533a'];

export default {
  title: '标签管理',
  render(el) {
    el.innerHTML = `${pageHead('标签管理', '删除已使用的标签时，所有个体会自动移除该标签', `<button class="btn" id="btn-add">＋ 新建标签</button>`)}
      <div class="card"><div class="list" id="tg-list"></div></div>`;

    function render() {
      const rows = listTags();
      el.querySelector('#tg-list').innerHTML = rows.length ? rows.map((t) => {
        const n = listAnimals().filter((a) => (a.tagIds || []).includes(t.id)).length;
        return `<div class="row" style="cursor:default">
          <span class="tag-dot" style="background:${t.color};width:16px;height:16px;flex-shrink:0"></span>
          <div class="row-main">
            <div class="row-title">${esc(t.name)}</div>
            <div class="row-sub">${n} 只个体使用</div>
          </div>
          <div class="row-side" style="display:flex;gap:6px">
            <button class="btn ghost sm" data-edit="${t.id}">编辑</button>
            <button class="btn ghost sm" data-del="${t.id}" style="color:var(--danger)">删除</button>
          </div>
        </div>`;
      }).join('') : emptyTip('🏷️', '暂无标签，创建后可在个体上标记');

      el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => tagModal(rows.find((x) => x.id === b.dataset.edit)); });
      el.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const t = rows.find((x) => x.id === b.dataset.del);
          const n = listAnimals().filter((a) => (a.tagIds || []).includes(t.id)).length;
          const ok = await confirmDialog('删除标签',
            n > 0 ? `标签「${t.name}」正被 ${n} 只个体使用，删除后这些个体会自动移除该标签。确定删除？` : `确定删除标签「${t.name}」？`,
            { okText: '删除', danger: true });
          if (!ok) return;
          await removeTag(t.id);
          toast(n > 0 ? `已删除，${n} 只个体已移除该标签` : '已删除', 'ok');
          render();
        };
      });
    }

    el.querySelector('#btn-add').onclick = () => tagModal(null);

    async function tagModal(t) {
      const editing = !!t;
      const res = await runModal({
        title: editing ? '编辑标签' : '新建标签',
        bodyHtml: `
          <div class="field"><label>名称<span class="req">*</span></label><input type="text" id="t-name" value="${editing ? esc(t.name) : ''}" maxlength="12" placeholder="例如：高白 / 待出手"></div>
          <div class="field"><label>颜色</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="color" id="t-color" value="${editing ? t.color : '#2e9e6b'}" style="width:44px;height:34px;border:1px solid var(--line);border-radius:8px;background:var(--card);padding:2px">
              ${PRESETS.map((c) => `<span class="tag-dot" data-color="${c}" style="background:${c};width:18px;height:18px;cursor:pointer;border:1px solid rgba(0,0,0,.15)"></span>`).join('')}
            </div>
          </div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
        mount: (mask) => {
          mask.querySelectorAll('[data-color]').forEach((d) => { d.onclick = () => { mask.querySelector('#t-color').value = d.dataset.color; }; });
        },
      });
      if (!res) return;
      const name = (document.getElementById('t-name').value || '').trim();
      if (!name) { toast('标签名称不能为空', 'warn'); return; }
      const color = document.getElementById('t-color').value;
      try {
        if (editing) { await updateTag(t.id, { name, color }); toast('已保存', 'ok'); }
        else { await createTag(name, color); toast('已创建', 'ok'); }
        render();
      } catch (err) { toast(err.message, 'err'); }
    }

    render();
  },
};
