// pages/predict.js —— 基因配对预测（每次重新选择，不保存历史方案）
// v2.1：公母双方各选一个基因（单基因模型）；结果仅预测基因库内有效基因
// v2.2：点击「开始预测」弹窗展示结果（概率 / 基因性状 / 基因名称），支持导出图片；
//       精确枚举替代蒙特卡洛；复合基因按基因库 comboOf 匹配命名
// v2.3：删除基因状态（表现）选择——按遗传类型自动取默认状态；复合基因拆解为组分基因
//       参与计算（缺黄莉莉 → 缺黄 + 莉莉白）；不完全显性双拷贝命名「超级X」并提示健康风险
// v2.4：「开始预测」旁新增基因互换按钮（互换公母所选基因）；隐性仅携带不显现的名称加「隐」
//       前缀；超级体名称标红、隐携带标蓝（ui.js outcomeTableHtml/outcomeSvg）
// v3.5：公母每方可多选基因（select[multiple] 自研下拉弹层）；基因类别筛选（全部/显性/隐性/
//       不完全显性/复合/杂合）移入下拉弹层内；新增「杂合（het）」类型并纳入预测计算
//       —— het 基因与对应隐性基因共享同一位点，按 h 态（单份携带）参与孟德尔分离。
'use strict';

import { App } from '../app.js';
import { esc, toast, runModal } from '../util.js';
import { pageHead, outcomeTableHtml, outcomeSvg } from '../ui.js';
import { listSpecies, listGenes, speciesName } from '../store.js';
import { predictOutcomes, expandLoci } from '../genetics.js';
import { geneDetailModal, findGenesByName } from '../gene-detail.js';
import { svgToPng } from '../charts.js';

const TYPE_LABEL = { dominant: '显性', recessive: '隐性', het: '杂合', incomplete: '不完全显性', combo: '复合', polygenic: '多基因选育（已取消）' };
// 「原色」为野生型基准基因：选择它等同于不选（无特殊基因），预测时按无基因处理
const WILD_GENE = '原色';
// 基因类别筛选（v2.0 起不含多基因选育；v3.5 新增杂合）—— 移入下拉弹层内
const TYPE_FILTERS = [
  { v: '', l: '全部' }, { v: 'dominant', l: '显性' }, { v: 'recessive', l: '隐性' },
  { v: 'het', l: '杂合' }, { v: 'incomplete', l: '不完全显性' }, { v: 'combo', l: '复合' },
];

export default {
  title: '基因预测',
  render(el) {
    const species = listSpecies();
    const state = {
      speciesId: species[0] ? species[0].id : '',
      male: [],      // v3.5：基因 id 数组（每方可多选）
      female: [],
      result: null,
    };

    el.innerHTML = `
      ${pageHead('基因配对预测', '公母每方可选多个基因，预测后代各组合的概率', `
        <button class="btn" id="btn-run">🧬 开始预测</button>
        <button class="btn ghost" id="btn-swap" title="互换公母双方已选基因">🔄 互换</button>`)}
      <div class="card">
        <div class="field" style="max-width:280px"><label>物种</label>
          <select id="f-species">${species.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
          <div class="hint">基因库按物种划分，可在「基因库」页自定义</div>
        </div>
        <div class="gene-sel-row">
          <div class="gene-col">
            <h4><span class="sex-ico sex-m">♂</span> 公方基因</h4>
            <div id="male-box"></div>
          </div>
          <div class="gene-col">
            <h4><span class="sex-ico sex-f">♀</span> 母方基因</h4>
            <div id="female-box"></div>
          </div>
        </div>
        <div class="hint">每方可多选基因（点下拉框后勾选多个）。类别筛选（全部 / 显性 / 隐性 / 杂合 / 不完全显性 / 复合）已移入下拉框内，无需手动选择携带状态，按基因类型自动取值：显性/隐性按纯合表现、不完全显性按单拷贝；「杂合（隐X）」表示该隐性基因的单份携带，与对应隐性基因共享同一位点参与计算；复合基因自动按组分参与计算（如 缺黄莉莉 = 缺黄 + 莉莉白）。点「开始预测」后弹窗展示后代的概率、基因性状与基因名称，可导出图片。两个不完全显性基因配对可能产生「超级体」，结果中将标注健康风险。</div>
      </div>`;

    el.querySelector('#f-species').onchange = (e) => {
      state.speciesId = e.target.value;
      state.male = []; state.female = []; state.result = null;
      renderSides();
    };

    function genePool() {
      // 仅基因库内有效基因（排除已失效/软删除与已取消的多基因选育）
      return listGenes(state.speciesId).filter((g) => !g.isInvalid && g.type !== 'polygenic');
    }
    // v3.5：类别筛选定义（移入下拉弹层内）—— 传给 picker 的 data-pk-filters
    const PK_FILTERS = JSON.stringify(TYPE_FILTERS.map((t) => ({ key: 'type', v: t.v, l: t.l })));
    function sideHtml(side) {
      const cur = state[side] || [];
      const pool = genePool();
      const selStyle = 'flex:1;padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)';
      return `
        <div class="prob-row" style="cursor:default">
          <select class="g-sel" multiple data-pk-title="选择基因（可多选）" data-pk-filters='${PK_FILTERS}' data-pk-empty-text="点击选择基因（可多选）…" style="${selStyle}">
            ${pool.map((x) => `<option value="${x.id}" data-type="${x.type}" ${cur.includes(x.id) ? 'selected' : ''}>${esc(x.name)}（${TYPE_LABEL[x.type] || x.type}）</option>`).join('')}
          </select>
        </div>`;
    }
    function bindSide(side) {
      const box = el.querySelector(`#${side}-box`);
      box.innerHTML = sideHtml(side);
      const gSel = box.querySelector('.g-sel');
      gSel.onchange = () => {
        state[side] = [...gSel.selectedOptions].map((o) => o.value);
        state.result = null;
      };
    }
    function renderSides() { bindSide('male'); bindSide('female'); }
    renderSides();

    // 汇总公母基因（公母选同一基因时合并为一行；「原色」按野生型剔除；
    // v3.5：每方多基因；复合基因拆解为组分；杂合基因映射到对应隐性位点的 h 态）
    function collectGenes() {
      const pool = genePool();
      const loci = { male: new Map(), female: new Map() };
      let anyPicked = false;
      ['male', 'female'].forEach((side) => {
        const ids = state[side] || [];
        if (!ids.length) return;
        anyPicked = true;
        ids.forEach((gid) => {
          const g = pool.find((y) => y.id === gid);
          if (!g) return;
          if (g.name === WILD_GENE) return;   // 野生型：不参与预测
          expandLoci(g, pool).forEach((c) => {
            const prev = loci[side].get(c.id);
            // 同一侧同一位点多次入选：以「杂合（h）」为准（显式单份携带优先于默认纯合）
            if (!prev || (prev.state !== 'h' && c.state === 'h')) {
              loci[side].set(c.id, { id: c.id, name: c.name, type: c.type, state: c.state });
            }
          });
        });
      });
      const merged = new Map();
      ['male', 'female'].forEach((side) => {
        loci[side].forEach((c, id) => {
          if (!merged.has(id)) merged.set(id, { id, name: c.name, type: c.type, male: 'n', female: 'n' });
          merged.get(id)[side] = c.state;
        });
      });
      return { list: [...merged.values()].filter((g) => g.male !== 'n' || g.female !== 'n'), anyPicked };
    }
    function recapHtml() {
      const pool = genePool();
      const recap = [];
      ['male', 'female'].forEach((side) => {
        const ids = state[side] || [];
        if (!ids.length) return;
        const names = ids.map((id) => {
          const g = pool.find((y) => y.id === id);
          return g ? g.name : '';
        }).filter(Boolean);
        if (names.length) recap.push(`${side === 'male' ? '公方' : '母方'} ${esc(names.join('、'))}`);
      });
      return recap.join(' × ') || '—';
    }

    el.querySelector('#btn-run').onclick = () => {
      const { list, anyPicked } = collectGenes();
      if (!anyPicked) { toast('请先为公母双方选择基因', 'warn'); return; }
      if (!list.length) {
        // 双方均为「原色/野生型」：后代 100% 原色
        state.result = { rows: [{ prob: 1, probText: '100%', phenotype: '原色', name: '原色', genes: [] }], warnings: [] };
      } else {
        // 结果仅预测基因库内有效基因（speciesGenes 同样过滤）
        state.result = predictOutcomes(list, genePool());
      }
      showResultModal();
    };

    // v2.4：互换公母已选基因（v3.5：支持多基因数组整体互换）
    el.querySelector('#btn-swap').onclick = () => {
      const m = state.male, f = state.female;
      state.male = f; state.female = m;
      state.result = null;
      renderSides();
      if (state.male.length || state.female.length) toast('已互换公母基因', 'ok');
      else toast('公母双方均未选择基因', 'warn');
    };

    function showResultModal() {
      const r = state.result;
      const spName = speciesName(state.speciesId);
      const sub = recapHtml();
      runModal({
        title: `预测结果 · ${spName}`,
        bodyHtml: `
          <div class="hint" style="margin-bottom:10px">${sub}</div>
          <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
            <button class="btn ghost sm" id="gp-img">📷 导出图片</button>
          </div>
          ${outcomeTableHtml(r, { clickable: true })}`,
        buttons: [{ text: '关闭', cls: 'ghost', value: null }],
        mount: (mask) => {
          mask.querySelector('#gp-img').onclick = () => exportImage(r, spName, sub);
          // v3.3：点击「基因名称」中的某一段 → 打开该基因的详情（按名称在基因库中检索匹配）
          mask.querySelectorAll('.gp-name-link').forEach((a) => {
            a.onclick = async () => {
              const nm = a.dataset.gpName || '';
              const pool = genePool();
              const hits = findGenesByName(nm, pool);
              if (!hits.length) { toast(`基因库中没有名为「${nm}」的基因`, 'warn'); return; }
              if (hits.length === 1) { await geneDetailModal(hits[0]); return; }
              // 多段命中（如「白化+康达」）→ 逐个列出供选择
              await runModal({
                title: `基因详情 · ${nm}`,
                bodyHtml: `<div class="list">${hits.map((g) => `
                  <div class="row" data-gid="${g.id}" style="cursor:pointer">
                    <div class="row-main">
                      <div class="row-title"><span class="rt-name">${esc(g.name)}</span></div>
                      <div class="row-sub">${esc(g.en || '')} · ${TYPE_LABEL[g.type] || g.type}</div>
                    </div>
                    <div class="row-side" style="color:var(--muted);font-size:18px">›</div>
                  </div>`).join('')}</div>`,
                buttons: [{ text: '关闭', cls: 'ghost', value: null }],
                mount(m2) {
                  m2.querySelectorAll('[data-gid]').forEach((row) => {
                    row.onclick = () => {
                      const g = hits.find((x) => x.id === row.dataset.gid);
                      if (g) geneDetailModal(g);
                    };
                  });
                },
              });
            };
          });
        },
      });
    }

    function exportImage(r, spName, sub) {
      const svg = outcomeSvg(r, { title: `基因配对预测 · ${spName}`, subtitle: sub });
      const tmp = document.createElement('div');
      tmp.innerHTML = svg;
      tmp.style.position = 'fixed';
      tmp.style.left = '-9999px';
      document.body.appendChild(tmp);
      svgToPng(tmp.querySelector('svg'), '基因配对预测.png', { bg: '#ffffff', scale: 2 });
      setTimeout(() => tmp.remove(), 1500);
    }
  },
};
