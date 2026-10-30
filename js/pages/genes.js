// pages/genes.js —— 基因库管理（增删改 / 恢复出厂 / 导入导出）
'use strict';

import { esc, toast, runModal, confirmDialog, download, readFileAsText, nowStr, nowIso } from '../util.js';
import { xlsxBlob, readXlsxFile, rowsToSheet, sheetToRows } from '../xlsx.js';
import { pageHead, emptyTip } from '../ui.js';
import {
  listSpecies, listGenes, createGene, updateGene, removeGene, geneUsedCount, speciesName,
  resetGenes, importGenes, isDerivedHet, S,
} from '../store.js';
import { GENE_TYPES, LEGACY_GENE_TYPE } from '../schema.js';
import { geneDetailModal } from '../gene-detail.js';

// TYPE_LABEL 保留旧版「多基因选育」仅用于兼容展示存量数据（v2.0 已取消该类型）
const TYPE_LABEL = { dominant: '显性', recessive: '隐性', het: '杂合', incomplete: '不完全显性', polygenic: '多基因选育（已取消）', combo: '复合' };

export default {
  title: '基因库',
  render(el) {
    const state = { speciesId: '', type: '', q: '' };
    el.innerHTML = `
      ${pageHead('基因库', '个体基因只能从基因库下拉选择，禁止自由文本录入；内置基因不可修改/删除，点击基因查看详情', `
        <button class="btn" id="btn-add">＋ 自定义基因</button>
        <button class="btn ghost" id="btn-export">📤 导出</button>
        <button class="btn ghost" id="btn-import">📂 导入</button>
        <button class="btn ghost" id="btn-reset" style="color:var(--warn)">♻️ 恢复出厂</button>`)}
      <div class="card">
        <div class="search-box">
          <input type="text" id="f-q" placeholder="搜索基因名称 / 英文名…">
        </div>
        <div class="seg" id="f-species"></div>
        <div class="seg" id="f-type" style="margin-top:8px"></div>
        <div style="overflow-x:auto"><table class="tbl" id="gene-tbl">
          <thead><tr><th>基因</th><th>遗传</th><th>物种</th><th>来源</th><th>被引用</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
      </div>
      <input type="file" id="file-import" accept=".xlsx,.json,application/json" style="display:none">
    `;

    const seg = el.querySelector('#f-species');
    const typeSeg = el.querySelector('#f-type');
    const TYPE_ORDER = ['', 'dominant', 'recessive', 'het', 'incomplete', 'combo'];
    function fillSeg() {
      const opts = [{ v: '', l: '全部物种' }, ...listSpecies().map((s) => ({ v: s.id, l: s.name }))];
      seg.innerHTML = opts.map((o) => `<div class="seg-item ${o.v === state.speciesId ? 'active' : ''}" data-v="${o.v}">${esc(o.l)}</div>`).join('');
    }
    function fillTypeSeg() {
      const opts = TYPE_ORDER.map((v) => ({ v, l: v === '' ? '全部类型' : (GENE_TYPES[v] || {}).label || v }));
      typeSeg.innerHTML = opts.map((o) => `<div class="seg-item ${o.v === state.type ? 'active' : ''}" data-v="${o.v}">${esc(o.l)}</div>`).join('');
    }
    function renderTbl() {
      const kw = (state.q || '').trim().toLowerCase();
      const rows = listGenes(state.speciesId)
        .filter((g) => !state.type || g.type === state.type)
        // v3.3：按名称 / 英文名 / 复合组分检索基因（猪鼻蛇基因较多，需要快速查找）
        .filter((g) => {
          if (!kw) return true;
          if ((g.name || '').toLowerCase().includes(kw)) return true;
          if ((g.en || '').toLowerCase().includes(kw)) return true;
          if ((g.comboOf || []).some((n) => String(n).toLowerCase().includes(kw))) return true;
          return false;
        })
        .sort((a, b) => (a.isCustom ? 1 : 0) - (b.isCustom ? 1 : 0) || a.name.localeCompare(b.name, 'zh'));
      const tb = el.querySelector('#gene-tbl tbody');
      tb.innerHTML = rows.length ? rows.map((g) => `
        <tr data-id="${g.id}" style="cursor:pointer" title="点击查看详情">
          <td><b>${esc(g.name)}</b></td>
          <td>${TYPE_LABEL[g.type] || g.type}</td>
          <td>${esc(speciesName(g.speciesId) || '—')}</td>
          <td>${g.isCustom ? '自定义' : '内置'}${g.type === 'het' ? ' · 自动派生' : ''}</td>
          <td>${geneUsedCount(g.id)}</td>
          <td style="white-space:nowrap">
            <button class="btn ghost sm" data-detail="${g.id}">详情</button>
            ${g.isCustom && !isDerivedHet(g) ? `<button class="btn ghost sm" data-edit="${g.id}">编辑</button>
            <button class="btn ghost sm" data-del="${g.id}" style="color:var(--danger)">删除</button>` : ''}
          </td>
        </tr>`).join('') : `<tr><td colspan="6">${emptyTip('🧬', '没有符合筛选条件的基因')}</td></tr>`;
      // 点击行（非按钮区）→ 基因详情弹窗（v2.5）
      tb.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.onclick = (e) => {
          if (e.target.closest('button')) return;
          const g = rows.find((x) => x.id === tr.dataset.id);
          if (g) showGeneDetail(g);
        };
      });
      tb.querySelectorAll('[data-detail]').forEach((b) => { b.onclick = () => showGeneDetail(rows.find((g) => g.id === b.dataset.detail)); });
      // 仅自定义基因可编辑 / 删除（v2.5：内置基因锁定）
      tb.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => geneModal(rows.find((g) => g.id === b.dataset.edit)); });
      tb.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteGeneFlow(rows.find((x) => x.id === b.dataset.del)); });
    }
    // 删除自定义基因（内置基因在 UI 层不出现该入口；store 层亦有守卫）
    async function deleteGeneFlow(g) {
      if (!g) return;
      const used = geneUsedCount(g.id);
      const ok = await confirmDialog('删除基因',
        used > 0
          ? `「${g.name}」正被 ${used} 只个体的基因列表引用。删除后将从这些个体上移除该基因。确定删除？`
          : `确定删除基因「${g.name}」？`,
        { okText: '删除', danger: true });
      if (!ok) return;
      const n = await removeGene(g.id);
      toast(n > 0 ? `已删除，${n} 只个体上的该基因已移除` : '已删除', 'ok');
      renderTbl();
    }
    // 基因详情弹窗（v2.5：点击任意基因弹出；v3.3 抽到 gene-detail.js 供预测结果共用）
    async function showGeneDetail(g) {
      await geneDetailModal(g, {
        onEdit: (x) => geneModal(x),
        onDelete: (x) => deleteGeneFlow(x),
      });
    }
    seg.addEventListener('click', (e) => {
      const item = e.target.closest('.seg-item');
      if (!item) return;
      state.speciesId = item.dataset.v;
      fillSeg(); renderTbl();
    });
    typeSeg.addEventListener('click', (e) => {
      const item = e.target.closest('.seg-item');
      if (!item) return;
      state.type = item.dataset.v;
      fillTypeSeg(); renderTbl();
    });

    el.querySelector('#btn-add').onclick = () => geneModal(null);

    // v3.3：基因名称检索
    const qInput = el.querySelector('#f-q');
    qInput.addEventListener('input', (e) => { state.q = e.target.value; renderTbl(); });

    /* ---------- 导出（Excel 表格） ---------- */
    el.querySelector('#btn-export').onclick = () => {
      const rows = S.gene;
      if (!rows.length) { toast('基因库为空', 'warn'); return; }
      const stamp = nowStr().replace(/[-: ]/g, '').slice(0, 12);
      download(`养个爬基因库_${stamp}.xlsx`, xlsxBlob([{ name: '基因库', rows: rowsToSheet(rows) }]));
      toast(`已导出 ${rows.length} 条基因（Excel）`, 'ok');
    };

    /* ---------- 导入（Excel 或旧版 JSON） ---------- */
    el.querySelector('#btn-import').onclick = () => el.querySelector('#file-import').click();
    el.querySelector('#file-import').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let pkg;
      try {
        if (/\.xlsx$/i.test(file.name) || (file.type || '').includes('sheet')) {
          const { sheets } = await readXlsxFile(file);
          const sheet = sheets.find((s) => s.name !== '_meta') || sheets[0];
          const genes = sheetToRows(sheet.rows);
          pkg = { app: 'reptile-breeding-genes', format: 1, exportedAt: nowIso(), counts: { gene: genes.length }, genes };
        } else {
          pkg = JSON.parse(await readFileAsText(file));
        }
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
        return;
      }
      const mode = await runModal({
        title: '导入基因库',
        bodyHtml: `<div style="line-height:1.8;font-size:13.5px">
          文件包含 <b>${Array.isArray(pkg.genes) ? pkg.genes.length : 0}</b> 条基因。<br>
          <b>合并导入</b>：按 ID 覆盖同名/同 ID 基因，不影响未涉及的基因。<br>
          <b>全量替换</b>：清空当前基因库后写入文件内容（自定义基因将丢失）。
        </div>`,
        buttons: [
          { text: '取消', cls: 'ghost', value: null },
          { text: '合并导入', value: 'merge' },
          { text: '全量替换', cls: 'danger', value: 'replace' },
        ],
      });
      if (!mode) return;
      try {
        const n = await importGenes(pkg, mode);
        toast(`导入成功，共 ${n} 条基因`, 'ok');
        fillSeg(); renderTbl();
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
      }
    };

    /* ---------- 恢复出厂（仅基因库） ---------- */
    el.querySelector('#btn-reset').onclick = async () => {
      const ok1 = await confirmDialog('恢复基因库',
        '将清空当前基因库（含自定义基因）并重建内置基因数据。\n个体上已引用的自定义基因不会被清除，但将从可选列表消失。建议先「导出」。此操作不可恢复！',
        { okText: '我已了解，继续', danger: true });
      if (!ok1) return;
      const n = await resetGenes();
      toast(`基因库已恢复出厂（${n} 条内置基因）`, 'ok');
      fillSeg(); renderTbl();
    };

    async function geneModal(g) {
      const editing = !!g;
      const spList = listSpecies();
      const legacy = editing && g.type === LEGACY_GENE_TYPE;
      // v3.5：杂合（het）类型由隐性基因自动派生，不在可选项中
      const typeOpts = Object.entries(GENE_TYPES).filter(([v]) => v !== 'het')
        .map(([v, t]) => `<option value="${v}" ${editing && g.type === v ? 'selected' : ''}>${t.label} — ${t.desc}</option>`).join('');
      const comboOfTxt = editing && Array.isArray(g.comboOf) ? g.comboOf.join('、') : '';
      const res = await runModal({
        title: editing ? '编辑基因' : '自定义基因',
        bodyHtml: `
          <div class="field"><label>所属物种<span class="req">*</span></label><select id="g-sp" ${editing ? 'disabled' : ''}>${spList.map((s) => `<option value="${s.id}" ${editing && g.speciesId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><label>基因名称<span class="req">*</span></label><input type="text" id="g-name" value="${editing ? esc(g.name) : ''}" placeholder="例如：雪白"></div>
          <div class="field"><label>英文名</label><input type="text" id="g-en" value="${editing ? esc(g.en || '') : ''}" placeholder="可选"></div>
          <div class="field"><label>遗传方式<span class="req">*</span></label><select id="g-type">
            ${legacy ? '<option value="polygenic" selected disabled>多基因选育（旧版已取消，不参与预测）</option>' : ''}
            ${typeOpts}
          </select>
          ${legacy ? '<div class="hint">该基因为旧版「多基因选育」类型，v2.0 起已取消；如无需保留旧类型，可改为其他遗传方式。</div>' : ''}
          </div>
          <div class="field" id="g-combo-wrap" style="display:none"><label>复合基因组分</label>
            <input type="text" id="g-combo" value="${esc(comboOfTxt)}" placeholder="多个组分基因名，用「、」分隔，例如：卡布奇诺、莉莉白">
            <div class="hint">填写后，基因预测时若公母双方均入选这些组分基因，将按各组分「显现概率」的乘积推导本基因的显现概率；留空则按隐性近似。</div>
          </div>
          <div class="field"><label>说明</label><textarea id="g-desc" placeholder="表现描述、配对注意事项（超级体风险等）">${editing ? esc(g.desc || '') : ''}</textarea></div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
        mount(mask) {
          const typeSel = mask.querySelector('#g-type');
          const comboWrap = mask.querySelector('#g-combo-wrap');
          const sync = () => { comboWrap.style.display = typeSel.value === 'combo' ? '' : 'none'; };
          typeSel.onchange = sync;
          sync();
        },
      });
      if (!res) return;
      const v = (id) => (document.getElementById(id) || {}).value || '';
      const name = v('g-name').trim();
      if (!name) { toast('基因名称不能为空', 'warn'); return; }
      const type = v('g-type');
      const comboOf = type === 'combo'
        ? v('g-combo').split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
        : [];
      const data = { name, en: v('g-en').trim(), type, desc: v('g-desc').trim(), comboOf };
      try {
        if (editing) {
          await updateGene(g.id, data);
          toast('已保存', 'ok');
        } else {
          await createGene({ speciesId: v('g-sp'), ...data });
          toast('基因已创建', 'ok');
        }
        renderTbl();
      } catch (err) { toast(err.message, 'err'); }
    }

    fillSeg(); fillTypeSeg(); renderTbl();
  },
};
