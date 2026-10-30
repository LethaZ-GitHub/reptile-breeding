// pages/egg-detail.js —— 蛋详情：状态机 / 归档 / 报废 / 孵化个体关联
'use strict';

import { App } from '../app.js';
import { esc, toast, todayStr, daysBetween, confirmDialog, runModal } from '../util.js';
import { pageHead, emptyTip, sexIco, animalThumbHtml, outcomeTableHtml, outcomeSvg } from '../ui.js';
import {
  getEgg, updateEgg, archiveEgg, unarchiveEgg, removeEgg, animalName, speciesName,
  EGG_STATUS, S, listAnimals, listGenes, linkEggAnimal, unlinkEggAnimal, eggUnlinked, linkedAnimalBrief, animalGeneStateText,
} from '../store.js';
import { geneStateOptions, outcomeLabel, defaultGeneState, expandCombo, expandLoci, predictOutcomes } from '../genetics.js';
import { svgToPng } from '../charts.js';
import { eggFormModal } from './eggs.js';

export default {
  title: '蛋详情',
  render(el, params) {
    const e = getEgg(params.id);
    if (!e) { el.innerHTML = emptyTip('🥚', '蛋记录不存在'); return; }
    const mother = S.animal.find((a) => a.id === e.motherId);
    const father = e.fatherId ? S.animal.find((a) => a.id === e.fatherId) : null;
    const motherGeneText = animalGeneStateText(mother);
    const fatherGeneText = animalGeneStateText(father);
    const st = EGG_STATUS[e.status] || EGG_STATUS.fertile;
    const left = e.expectHatchDate ? daysBetween(todayStr(), e.expectHatchDate) : null;
    const hatchTodo = S.todo.find((t) => t.sourceType === 'egg-hatch' && t.sourceId === e.id);
    const unlinked = eggUnlinked(e);
    const linked = linkedAnimalBrief(e);

    el.innerHTML = `
      ${pageHead(`蛋 ${esc(e.code || '')}`, `${esc(animalName(e.motherId) || '')} 的蛋 · ${esc(e.layDate || '未知日期')}`,
        `<button class="btn" id="btn-edit">✏️ 编辑</button>
         <button class="btn" id="btn-gpred">🧬 基因预测</button>
         <button class="btn ghost" id="btn-arch">${e.isArchived ? '↩️ 取消归档' : '📦 归档'}</button>
         <button class="btn ghost" id="btn-del" style="color:var(--danger)">🗑 删除</button>`)}
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div class="animal-thumb" style="font-size:26px">🥚</div>
          <div>
            <div style="font-weight:700;font-size:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              当前状态 <span class="egg-st ${st.cls}">${st.label}</span>
              ${e.isArchived ? '<span class="st st-unknown">已归档</span>' : ''}
              ${unlinked ? '<span class="st st-unknown" title="已孵化但未登记关联个体">⚠️ 未关联个体</span>' : ''}
              ${linked ? `<span class="egg-st hatched">🦎 已关联 ${esc(linked.animal.code || linked.animal.name)}</span>` : ''}
            </div>
            <div style="color:var(--muted);font-size:12.5px;margin-top:4px">
              ${e.expectHatchDate ? `预计破壳 ${esc(e.expectHatchDate)}` : '未填预计破壳日期'}
              ${left != null && e.status === 'fertile' ? (left < 0 ? ' · <span class="countdown overdue">已超期 ' + (-left) + ' 天</span>' : left === 0 ? ' · <span class="countdown soon">今天破壳</span>' : ' · 还剩 ' + left + ' 天') : ''}
            </div>
          </div>
        </div>
        <div class="cage-preview">
          <div class="pv-row"><span class="k">母本</span><span>${mother ? `<a href="#/animal/${mother.id}">${esc(mother.name)}</a> ${sexIco(mother.sex)}${mother.code ? ` · 编号 ${esc(mother.code)}` : ''}${motherGeneText ? ` · ${esc(motherGeneText)}` : ''}` : '—'}</span></div>
          <div class="pv-row"><span class="k">父本</span><span>${father ? `<a href="#/animal/${father.id}">${esc(father.name)}</a> ${sexIco(father.sex)}${father.code ? ` · 编号 ${esc(father.code)}` : ''}${fatherGeneText ? ` · ${esc(fatherGeneText)}` : ''}` : '未填写'}</span></div>
          <div class="pv-row"><span class="k">物种</span><span>${esc(speciesName(e.speciesId) || (mother ? speciesName(mother.speciesId) : '') || '—')}</span></div>
          <div class="pv-row"><span class="k">产蛋日期</span><span>${esc(e.layDate || '—')}</span></div>
          <div class="pv-row"><span class="k">孵化温度</span><span>${e.temp != null ? esc(e.temp) + ' ℃' : '—'}</span></div>
          <div class="pv-row"><span class="k">破壳待办</span><span>${hatchTodo ? (hatchTodo.status === 'pending' ? '进行中（截止 ' + esc(hatchTodo.deadline) + '）' : hatchTodo.status === 'done' ? '已完成' : '已取消') : '未生成'}</span></div>
          <div class="pv-row"><span class="k">归档原因</span><span>${e.isArchived ? esc(e.archiveReason === 'manual' ? '手动归档' : e.archiveReason === 'auto-dead' ? '报废' : e.archiveReason === 'hatched' ? '已孵化' : e.archiveReason || '—') : '—'}</span></div>
          <div class="pv-row"><span class="k">关联个体</span><span>${linked
            ? `<a href="#/animal/${linked.animal.id}">${esc(linked.animal.name)}</a> · 编号 ${esc(linked.animal.code || '—')} · 基因 ${esc(linked.geneStateText || linked.geneText)}`
            : (unlinked ? '<span style="color:var(--warn)">未关联（可手动关联下方个体）</span>' : '—')}</span></div>
          <div class="pv-row"><span class="k">备注</span><span>${esc(e.note || '—')}</span></div>
        </div>
        ${linked ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost sm" id="btn-link-other">🔁 更换关联个体</button>
          <button class="btn ghost sm" id="btn-unlink" style="color:var(--danger)">⛓️‍💥 解除关联</button>
        </div>` : (unlinked ? `<div style="margin-top:12px"><button class="btn" id="btn-link">🔗 关联个体</button></div>` : '')}
        <div style="margin-top:14px">
          <div class="field" style="max-width:260px"><label>变更蛋状态</label>
            <select id="f-status">${Object.entries(EGG_STATUS).map(([v, s]) => `<option value="${v}" ${v === e.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
          </div>
          <div class="hint">标记为「受精」并填写预计破壳日期会自动生成/恢复破壳待办；变为其他状态会自动取消待办。标记「已孵化」后将引导新建个体并自动关联本蛋。</div>
        </div>
      </div>
    `;

    /* ---------- 关联个体 ---------- */
    const linkBtn = el.querySelector('#btn-link');
    if (linkBtn) linkBtn.onclick = () => linkAnimalFlow(e.id);
    const linkOther = el.querySelector('#btn-link-other');
    if (linkOther) linkOther.onclick = () => linkAnimalFlow(e.id);
    const unlinkBtn = el.querySelector('#btn-unlink');
    if (unlinkBtn) unlinkBtn.onclick = async () => {
      const ok = await confirmDialog('解除关联', '将解除本蛋与关联个体的双向关联，个体记录本身保留。确定？', { okText: '解除', danger: true });
      if (!ok) return;
      await unlinkEggAnimal(e.id);
      toast('已解除关联');
      App.refresh();
    };

    el.querySelector('#f-status').onchange = async (ev) => {
      const v = ev.target.value;
      if (v === 'hatched' || v === 'dead') {
        const ok = await confirmDialog(v === 'dead' ? '标记报废' : '标记已孵化',
          v === 'dead' ? '报废后蛋进入归档列表，并自动取消破壳待办。同时归档这颗蛋吗？' : '孵化成功后建议归档这颗蛋（保留在归档列表备查）。同时归档吗？', { okText: '确定并归档' });
        await updateEgg(e.id, { status: v });
        if (ok) await archiveEgg(e.id, v === 'dead' ? 'auto-dead' : 'hatched');
        if (v === 'hatched') {
          // 孵化成功：自动弹出新建个体窗口，预填物种 / 父母本 / 出生日期（孵化日），保存后自动关联本蛋
          toast('已标记孵化，正在打开新建个体…', 'ok');
          App.go('#/animal/new?hatch=' + e.id);
          return;
        }
        toast('已标记报废');
        App.refresh();
      } else {
        await updateEgg(e.id, { status: v });
        toast('状态已更新');
        App.refresh();
      }
    };
    el.querySelector('#btn-arch').onclick = async () => {
      if (e.isArchived) { await unarchiveEgg(e.id); toast('已取消归档'); }
      else { await archiveEgg(e.id, 'manual'); toast('已归档，破壳待办已取消'); }
      App.refresh();
    };
    el.querySelector('#btn-del').onclick = async () => {
      const ok = await confirmDialog('删除蛋记录', '确定删除这颗蛋的记录吗？相关待办会同步删除，已关联的个体会解除来源关联。', { okText: '删除', danger: true });
      if (!ok) return;
      await removeEgg(e.id);
      toast('已删除');
      App.go('#/eggs');
    };
    el.querySelector('#btn-gpred').onclick = () => genePredictFlow(e);
    el.querySelector('#btn-edit').onclick = async () => {
      const spId = e.speciesId || (mother && mother.speciesId) || '';
      await eggFormModal(e, spId, speciesName(spId) || '蛋', () => App.refresh());
    };
  },
};

/* ---------- 蛋基因预测（孟德尔，v2.3 新模型） ----------
   按父母本已登记基因精确枚举后代组合：
   - 不提供状态选择（v2.3 起）；v2.6 起个体不再登记基因状态，统一按基因类型取默认值；
   - 复合基因拆解为组分基因参与计算（母本缺黄莉莉 → 缺黄 + 莉莉白）；
   - 每行 = 概率 / 基因性状（携带+显现的基因名连接）/ 基因名称（基因库已登记的复合基因名，否则沿用性状）；
   - 不完全显性双拷贝命名为「超级X」并附健康风险提示。 */
async function genePredictFlow(egg) {
  const mother = S.animal.find((a) => a.id === egg.motherId) || null;
  const father = egg.fatherId ? (S.animal.find((a) => a.id === egg.fatherId) || null) : null;
  const spId = egg.speciesId || (mother && mother.speciesId) || '';
  // v2.0 起多基因选育已取消、v2.1 起已失效（软删除）基因不参与预测；「原色」为野生型基准基因，等同未登记
  const pool = listGenes(spId).filter((g) => !g.isInvalid && g.type !== 'polygenic' && g.name !== '原色');
  const geneOf = (a) => (a && (a.geneIds || []).length)
    ? (listGenes().find((g) => g.id === a.geneIds[0] && !g.isInvalid && g.type !== 'polygenic' && g.name !== '原色') || null)
    : null;
  const motherGene = geneOf(mother);
  const fatherGene = geneOf(father);

  if (!motherGene && !fatherGene) {
    const act = await runModal({
      title: '蛋基因预测',
      bodyHtml: `<div style="line-height:1.8;font-size:13.5px">
        父母本均未登记基因，暂无法预测后代基因概率。<br>
        请先在「个体编辑」中为父母本选择基因，再来预测（预测时按基因的遗传类型取默认携带状态）。
      </div>`,
      buttons: [
        { text: '关闭', cls: 'ghost', value: null },
        ...(mother ? [{ text: '去登记母本基因', value: 'edit-mother' }] : []),
      ],
    });
    if (act === 'edit-mother' && mother) App.go('#/animal/edit/' + mother.id);
    return;
  }

  // 状态归一（v2.6 起个体不再登记基因状态）：按基因类型默认值，老数据/缺失同样回落默认
  const normState = (g) => {
    let v = defaultGeneState(g);
    if (g && g.type === 'incomplete' && v === 'v') v = 'h';
    const opts = geneStateOptions(g ? g.type : '');
    if (!opts.some((o) => o.value === v)) v = defaultGeneState(g);
    return v;
  };
  // v2.3：复合基因按组分拆解为多个 locus，公母双方按基因 id 合并
  // v3.5：改用 expandLoci —— 复合基因按组分拆解；杂合（het）基因映射到对应隐性位点的 h 态
  const loci = new Map();
  const addSide = (gene, side) => {
    if (!gene) return;
    expandLoci(gene, pool).forEach((c) => {
      if (!loci.has(c.id)) loci.set(c.id, { gene: c, male: 'n', female: 'n' });
      loci.get(c.id)[side] = c.state;
    });
  };
  addSide(motherGene, 'female');
  addSide(fatherGene, 'male');
  const blocks = [...loci.values()].filter((b) => b.male !== 'n' || b.female !== 'n');
  const r = predictOutcomes(
    blocks.map((b) => ({ name: b.gene.name, type: b.gene.type, male: b.male, female: b.female })),
    pool,
  );
  const recap = `${esc(mother ? mother.name : '未知母本')} × ${esc(father ? father.name : '未登记父本')}`;
  // 父母本基因说明（v2.6 起不再登记基因状态，状态按遗传类型取默认值并在此明示）
  const sideDesc = (gene, label) => {
    if (!gene) return `${label}：未登记`;
    const loci = expandLoci(gene, pool);
    const parts = loci.map((c) => `${esc(c.name)}（${outcomeLabel(c.type, c.state)}）`);
    return `${label}：${parts.join(' + ')}`;
  };
  const geneLine = `${sideDesc(fatherGene, '父方基因')}｜${sideDesc(motherGene, '母方基因')}`;
  // 复合基因拆解说明（仅当某一方登记了可拆分的复合基因时展示）
  const comboNotes = [];
  [[motherGene, '母本'], [fatherGene, '父本']].forEach(([g, label]) => {
    if (!g || g.type !== 'combo') return;
    const comps = expandCombo(g, pool);
    if (comps.length > 1) comboNotes.push(`${label}「${esc(g.name)}」按组分参与计算：${comps.map((c) => esc(c.name)).join(' + ')}`);
  });

  await runModal({
    title: '蛋基因预测 · 孟德尔',
    bodyHtml: `
      <div class="hint" style="margin-bottom:10px">
        ${recap}${spId ? ' · ' + esc(speciesName(spId) || '') : ''}
      </div>
      <div class="hint" style="margin-bottom:10px">${geneLine}</div>
      ${!father ? '<div class="warn-box" style="margin-bottom:10px">⚠️ 未登记父本：父方基因按「不携带」估算，结果仅反映母本单方贡献。</div>' : ''}
      ${mother && father && mother.speciesId !== father.speciesId ? '<div class="warn-box" style="margin-bottom:10px">⚠️ 父母本物种不一致，预测结果仅供参考。</div>' : ''}
      ${comboNotes.length ? `<div class="hint" style="margin-bottom:10px">${comboNotes.join('<br>')}</div>` : ''}
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
        <button class="btn ghost sm" id="gp-img">📷 导出图片</button>
      </div>
      ${outcomeTableHtml(r)}`,
    buttons: [{ text: '关闭', cls: 'ghost', value: null }],
    mount(mask) {
      mask.querySelector('#gp-img').onclick = () => {
        const svg = outcomeSvg(r, { title: '蛋基因预测', subtitle: recap });
        const tmp = document.createElement('div');
        tmp.innerHTML = svg;
        tmp.style.position = 'fixed';
        tmp.style.left = '-9999px';
        document.body.appendChild(tmp);
        svgToPng(tmp.querySelector('svg'), '蛋基因预测.png', { bg: '#ffffff', scale: 2 });
        setTimeout(() => tmp.remove(), 1500);
      };
    },
  });
}

/* ---------- 手动关联个体（优先同物种） ---------- */
async function linkAnimalFlow(eggId) {
  const egg = getEgg(eggId);
  if (!egg) return;
  const spId = egg.speciesId || (egg.motherId ? (S.animal.find((a) => a.id === egg.motherId) || {}).speciesId : '') || '';
  const sameSp = listAnimals().filter((a) => a.speciesId === spId);
  const others = listAnimals().filter((a) => a.speciesId !== spId);
  const picked = await runModal({
    title: '关联孵化个体',
    bodyHtml: `
      <div class="hint" style="margin-bottom:10px">选择由本蛋孵化出的个体。${spId ? '优先显示同物种个体。' : ''}</div>
      <div class="pick-list" style="max-height:50vh">
        ${sameSp.length ? `<div class="hint" style="margin:2px 0 6px">${esc(speciesName(spId) || '同物种')}</div>` : ''}
        ${sameSp.map((a) => pickRowHtml(a, egg)).join('')}
        ${others.length ? `<div class="hint" style="margin:10px 2px 6px">其他物种</div>` : ''}
        ${others.map((a) => pickRowHtml(a, egg)).join('')}
        ${!sameSp.length && !others.length ? '<div class="hint">暂无个体，请先新建个体</div>' : ''}
      </div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }],
    mount: (mask, close) => {
      mask.querySelectorAll('.pick-row').forEach((r) => { r.onclick = () => close(r.dataset.id); });
    },
  });
  if (!picked) return;
  await linkEggAnimal(eggId, picked);
  const a = listAnimals().find((x) => x.id === picked);
  toast(`已关联「${a ? a.name : ''}」`, 'ok');
  App.refresh();
}

function pickRowHtml(a, egg) {
  const cur = egg.hatchedAnimalId === a.id;
  return `<div class="pick-row ${cur ? 'picked' : ''}" data-id="${a.id}">
    ${animalThumbHtml(a)}
    <span class="pr-name">${esc(a.name)}</span>
    <span class="pr-sub">${esc(a.code || '')}${a.fromEggId ? ' · 已关联其他蛋' : ''}</span>
  </div>`;
}
