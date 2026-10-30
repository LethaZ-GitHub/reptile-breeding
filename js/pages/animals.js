// pages/animals.js —— 个体列表 / 个体归档（支持列表 / 小图标两种视图）
'use strict';

import { App } from '../app.js';
import { esc } from '../util.js';
import { pageHead, emptyTip, animalRowHtml, animalThumbHtml, sexIco, statusBadge, segHtml } from '../ui.js';
import { listAnimals, listSpecies, listTags } from '../store.js';

const PAGE_SIZE = 12;
// 视图模式：list=列表（现有样式）/ grid=小图标；会话间保持（localStorage）
let viewMode = 'list';
try { viewMode = localStorage.getItem('rb-animal-view') === 'grid' ? 'grid' : 'list'; } catch (e) { /* 隐私模式等 */ }

// 小图标单元格：仅缩略图 / 名字 / 编号 / 公母
// v3.3：恢复缩略图点击放大（不再标记 no-zoom）——点缩略图走全局灯箱，点其余区域进详情。
function animalGridHtml(a) {
  return `<div class="ag-cell" data-id="${a.id}" title="${esc(a.name)}">
    ${animalThumbHtml(a)}
    <div class="ag-name">${esc(a.name)}</div>
    <div class="ag-sub">${esc(a.code || '—')}</div>
    <div class="ag-sub">${sexIco(a.sex)}</div>
  </div>`;
}

export default {
  title: '个体列表',
  render(el, params) {
    const tab = params.tab || 'active'; // active | archived
    const state = { q: '', speciesId: '', sex: '', tagId: '', page: 1 };

    el.innerHTML = `
      ${pageHead(tab === 'archived' ? '个体归档' : '个体列表',
        tab === 'archived' ? '已售出 / 已离世 / 已赠送 / 手动归档的个体' : '全部在养个体',
        `<button class="btn" id="btn-new">＋ 新建个体</button>
         <button class="btn ghost" id="btn-arch">${tab === 'archived' ? '在养列表' : '归档列表'}</button>`)}
      <div class="card">
        <div class="search-box">
          <input type="text" id="f-q" placeholder="搜索个体名称…">
          <button class="btn ghost" id="btn-view" title="${viewMode === 'grid' ? '切换为列表视图' : '切换为小图标视图'}">${viewMode === 'grid' ? '📋' : '🔲'}</button>
        </div>
        <div class="seg" id="f-sex">${segHtml([
          { value: '', label: '全部性别' }, { value: 'male', label: '♂ 公' }, { value: 'female', label: '♀ 母' }, { value: 'unknown', label: '未知' },
        ], '', 'sex')}</div>
        <div class="seg" id="f-species"></div>
        <div class="seg" id="f-tag"></div>
        <div class="list list-grid" id="animal-list"></div>
        <div id="pager"></div>
      </div>
    `;

    // 物种 / 标签筛选条
    const spSeg = el.querySelector('#f-species');
    const speciesOpts = [{ value: '', label: '全部物种' }, ...listSpecies().map((s) => ({ value: s.id, label: s.name }))];
    spSeg.innerHTML = segHtml(speciesOpts, '', 'species');
    const tagSeg = el.querySelector('#f-tag');
    const tagOpts = [{ value: '', label: '全部标签' }, ...listTags().map((t) => ({ value: t.id, label: t.name }))];
    tagSeg.innerHTML = segHtml(tagOpts, '', 'tag');

    el.querySelector('#btn-new').onclick = () => App.go('#/animal/new');
    el.querySelector('#btn-view').onclick = () => {
      viewMode = viewMode === 'grid' ? 'list' : 'grid';
      try { localStorage.setItem('rb-animal-view', viewMode); } catch (e) { /* 忽略 */ }
      state.page = 1;
      const btn = el.querySelector('#btn-view');
      btn.textContent = viewMode === 'grid' ? '📋' : '🔲';
      btn.title = viewMode === 'grid' ? '切换为列表视图' : '切换为小图标视图';
      renderList();
    };
    el.querySelector('#btn-arch').onclick = () => App.go(tab === 'archived' ? '#/animals' : '#/animals/archive');

    function renderList() {
      const rows = listAnimals({
        q: state.q, speciesId: state.speciesId, sex: state.sex, tagId: state.tagId,
        status: tab === 'archived' ? 'archived' : 'active',
      });
      const listEl = el.querySelector('#animal-list');
      const start = (state.page - 1) * PAGE_SIZE;
      const page = rows.slice(start, start + PAGE_SIZE);
      if (!page.length) {
        listEl.innerHTML = emptyTip(tab === 'archived' ? '🗂️' : '🦎', tab === 'archived' ? '归档列表为空' : '还没有个体，点击右上角「新建个体」开始');
      } else if (viewMode === 'grid') {
        listEl.innerHTML = `<div class="animal-grid">${page.map(animalGridHtml).join('')}</div>`;
        listEl.querySelectorAll('.ag-cell').forEach((c) => {
          // v3.3：点缩略图 → 放大查看（不跳转）；点其余区域 → 进个体详情
          c.onclick = (e) => {
            if (e.target.closest('.animal-thumb')) return;
            App.go('#/animal/' + c.dataset.id);
          };
        });
      } else {
        // v3.3：恢复缩略图点击放大（v2.8 曾改为直接进详情）——
        // 点缩略图 → 全屏灯箱；点行内其它区域 → 进个体详情。
        listEl.innerHTML = page.map((a) => animalRowHtml(a)).join('');
        listEl.querySelectorAll('.row').forEach((r) => {
          r.onclick = (e) => {
            if (e.target.closest('.animal-thumb')) return;
            App.go('#/animal/' + r.dataset.id);
          };
        });
      }
      const pager = el.querySelector('#pager');
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      pager.innerHTML = rows.length > PAGE_SIZE
        ? `<div class="pager"><button ${state.page <= 1 ? 'disabled' : ''} data-p="prev">‹ 上一页</button><span>第 ${state.page} / ${pages} 页 · 共 ${rows.length} 只</span><button ${state.page >= pages ? 'disabled' : ''} data-p="next">下一页 ›</button></div>`
        : `<div class="pager"><span>共 ${rows.length} 只</span></div>`;
      pager.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          state.page += b.dataset.p === 'prev' ? -1 : 1;
          renderList();
        };
      });
    }

    el.querySelector('#f-q').addEventListener('input', (e) => { state.q = e.target.value; state.page = 1; renderList(); });
    // 注意：seg-item 的 data-* 属性名（sex/species/tag）与 state 键名（sex/speciesId/tagId）不同，需显式映射
    [['#f-sex', 'sex', 'sex'], ['#f-species', 'speciesId', 'species'], ['#f-tag', 'tagId', 'tag']].forEach(([sel, key, attr]) => {
      el.querySelector(sel).addEventListener('click', (e) => {
        const item = e.target.closest('.seg-item');
        if (!item) return;
        el.querySelector(sel).querySelectorAll('.seg-item').forEach((x) => x.classList.remove('active'));
        item.classList.add('active');
        state[key] = item.dataset[attr];
        state.page = 1;
        renderList();
      });
    });

    renderList();
  },
};
