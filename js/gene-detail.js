// gene-detail.js —— 基因详情弹窗（基因库页 / 基因预测结果共用）
// v3.3：从 genes.js 抽出，供预测结果表的「基因名称」点击查看基因详情。
'use strict';

import { esc, runModal } from './util.js';
import { speciesName, geneUsedCount, listGenes } from './store.js';

export const GENE_TYPE_LABEL = {
  dominant: '显性', recessive: '隐性', het: '杂合', incomplete: '不完全显性',
  combo: '复合', polygenic: '多基因选育（已取消）',
};

/**
 * 打开基因详情弹窗
 * @param {object} g 基因对象
 * @param {object} [opts]
 * @param {Function} [opts.onEdit] 点击「编辑」回调（不传则不显示编辑/删除按钮）
 * @param {Function} [opts.onDelete] 点击「删除」回调
 * @param {string} [opts.extraHtml] 追加到详情底部的额外 HTML
 */
export async function geneDetailModal(g, opts = {}) {
  if (!g) return null;
  const used = geneUsedCount(g.id);
  const fields = [
    ['基因名称', g.name],
    ['英文名', g.en || '—'],
    ['遗传方式', GENE_TYPE_LABEL[g.type] || g.type],
    ['所属物种', speciesName(g.speciesId) || '—'],
    ['来源', g.isCustom ? '自定义' : '内置'],
    ['被引用', `${used} 只个体`],
  ];
  if (g.type === 'combo' && (g.comboOf || []).length) fields.push(['复合组分', g.comboOf.join(' + ')]);
  // v3.5：杂合基因显示其对应的隐性基因
  if (g.type === 'het') {
    const base = (g.hetOf && listGenes().find((x) => x.id === g.hetOf))
      || listGenes().find((x) => x.type === 'recessive' && x.name === String(g.name || '').replace(/^隐/, ''));
    fields.push(['对应隐性基因', base ? base.name : '—']);
  }
  if (g.desc) fields.push(['说明', g.desc]);

  const canEdit = !!opts.onEdit && !!g.isCustom;
  const res = await runModal({
    title: '基因详情',
    bodyHtml: `
      <div class="gene-detail">
        ${fields.map(([k, v]) => `<div class="gd-row"><span class="gd-k">${esc(k)}</span><span class="gd-v">${esc(v)}</span></div>`).join('')}
      </div>
      ${g.isCustom ? '' : '<div class="hint" style="margin-top:10px">内置基因不可修改或删除；如需重置全部内置基因，可在「基因库」页使用「恢复出厂」。</div>'}
      ${opts.extraHtml || ''}`,
    buttons: canEdit
      ? [{ text: '关闭', cls: 'ghost', value: null }, { text: '编辑', value: 'edit' }, { text: '删除', cls: 'danger', value: 'del' }]
      : [{ text: '关闭', cls: 'ghost', value: null }],
  });
  if (res === 'edit' && opts.onEdit) opts.onEdit(g);
  else if (res === 'del' && opts.onDelete) opts.onDelete(g);
  return res;
}

/**
 * 在名称集合中查找匹配的基因（用于预测结果名称 → 基因详情）
 * 逐段按「+」拆分（表型名如「白化+康达」），逐段在基因库中按名称精确匹配。
 * @param {string} name 名称（可含「+」「超级」「隐」前缀）
 * @param {Array} pool 候选基因池
 * @returns {Array} 命中的基因数组
 */
export function findGenesByName(name, pool) {
  if (!name || !Array.isArray(pool)) return [];
  const hit = [];
  const parts = String(name).split('+').map((s) => s.trim()).filter(Boolean);
  for (const raw of parts) {
    // 去掉「超级」「隐」前缀后按名称匹配
    const base = raw.replace(/^(超级|隐)/, '');
    const g = pool.find((x) => x && (x.name === raw || x.name === base));
    if (g && !hit.includes(g)) hit.push(g);
  }
  return hit;
}
