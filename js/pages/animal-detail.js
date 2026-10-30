// pages/animal-detail.js —— 个体详情：概况 / 日志 / 照片 / 繁殖 / 谱系
'use strict';

import { App } from '../app.js';
import { esc, toast, todayStr, confirmDialog, runModal, fmtMoney, download, addDays } from '../util.js';
import { pageHead, sexIco, statusBadge, eggStatusBadge, emptyTip, animalThumbHtml } from '../ui.js';
import { lineChart, donutChart, svgToPng } from '../charts.js';
import { compressPhoto } from '../image.js';
import { HATCH_TEMP_DAYS } from '../schema.js';
import {
  getAnimal, speciesName, listPhotos, addPhoto, removePhoto, setThumbnail,
  listLogs, addLog, removeLog, LOG_TYPES, listEggs, createEgg, pedigreeOf, removeAnimal,
  setAnimalArchived, eggCountOfMother, listGenes, listTags, getCage, listPlans, animalName,
  dispWeight, dispLength, storeWeight, storeLength, updateAnimal, S,
  listPairings, PAIR_RESULTS, getEgg, clutchAnimals,
} from '../store.js';
import { unitWeight, unitLength, getSetting } from '../settings.js';
import { openSvgViewer } from '../lightbox.js';
import { logFormModal } from '../log-form.js';

const TABS = [
  { key: 'overview', label: '概况' },
  { key: 'logs', label: '饲养日志' },
  { key: 'photos', label: '照片' },
  { key: 'breeding', label: '繁殖' },
];

/* ================= 日志弹窗 ================= */
// v3.1：日志新增/修改表单抽出到 js/log-form.js（与「饲养日志」列表页共用）
async function logModal(animalId, type) {
  const a = getAnimal(animalId);
  const ok = await logFormModal({ animalId, type, speciesId: a ? a.speciesId : '' });
  return ok;
}

/* ================= 渲染 ================= */
export default {
  title: '个体详情',
  async render(el, params) {
    const a = getAnimal(params.id);
    if (!a) { el.innerHTML = emptyTip('❓', '个体不存在或已删除'); return; }
    // v2.6：谱系从 Tab 移到名字行最右侧，点击弹窗展示（?tab=pedigree 旧链接按概况渲染）
    const tab = (!params.tab || params.tab === 'pedigree') ? 'overview' : params.tab;

    const eggs = listEggs({ motherId: a.id });
    const cage = a.cageId ? getCage(a.cageId) : null;
    const cagePlan = cage ? listPlans().find((p) => p.id === cage.planId) : null;
    const bills = S.bill.filter((b) => b.relatedAnimalId === a.id).sort((x, y) => (y.date || '').localeCompare(x.date || ''));

    el.innerHTML = `
      ${pageHead(a.name, `${speciesName(a.speciesId) || '未设置物种'}`, `
        <button class="btn ghost" id="btn-edit">✏️ 编辑</button>
        <button class="btn ghost" id="btn-clone">🧬 克隆</button>
        <button class="btn ghost" id="btn-arch">${a.isArchived ? '↩️ 恢复' : '🗂️ 归档'}</button>
        <button class="btn ghost" id="btn-del" style="color:var(--danger)">🗑 删除</button>`)}
      <div class="card">
        <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
          ${animalThumbHtml(a)}
          <div style="flex:1;min-width:0">
            <div style="font-size:19px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${esc(a.name)} ${sexIco(a.sex)} ${statusBadge(a)}
              ${a.isArchived ? '<span class="st st-unknown">已归档</span>' : ''}
              <button class="btn ghost sm" id="btn-pedigree" style="margin-left:auto" title="查看三代族谱">🧬 谱系</button>
            </div>
            <div style="color:var(--muted);font-size:12.5px;margin-top:5px">
              ${(a.geneIds || []).length ? '基因：' + (a.geneIds || []).map((gid) => { const g = listGenes().find((x) => x.id === gid); return g ? esc(g.name) + (g.isInvalid ? '(失效)' : '') : ''; }).filter(Boolean).join('、') : ''}
            </div>
            ${a.phenotype ? `<div style="color:var(--muted);font-size:12.5px;margin-top:3px">表现：${esc(a.phenotype)}</div>` : ''}
            <div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">${(a.tagIds || []).map((tid) => { const t = listTags().find((x) => x.id === tid); return t ? `<span class="tag-chip" style="background:${t.color}">${esc(t.name)}</span>` : ''; }).join('')}</div>
          </div>
        </div>
        <div class="tabs" id="d-tabs">
          ${TABS.map((t) => `<div class="tab ${t.key === tab ? 'active' : ''}" data-tab="${t.key}">${t.label}${t.key === 'logs' ? ` (${listLogs(a.id).length})` : ''}${t.key === 'photos' ? ` (${listPhotos(a.id).length})` : ''}${t.key === 'breeding' ? ` (${eggs.length})` : ''}</div>`).join('')}
        </div>
        <div id="d-body"></div>
      </div>
    `;

    el.querySelectorAll('#d-tabs .tab').forEach((t) => { t.onclick = () => { App.go(`#/animal/${a.id}?tab=${t.dataset.tab}`); }; });
    el.querySelector('#btn-pedigree').onclick = () => pedigreeModal(a);
    el.querySelector('#btn-edit').onclick = () => App.go('#/animal/edit/' + a.id);
    el.querySelector('#btn-clone').onclick = () => App.go('#/animal/clone/' + a.id);
    el.querySelector('#btn-arch').onclick = async () => {
      await setAnimalArchived(a.id, !a.isArchived);
      toast(a.isArchived ? '已恢复' : '已移入归档', 'ok');
      App.refresh();
    };
    el.querySelector('#btn-del').onclick = async () => {
      const eggN = eggs.length, logN = listLogs(a.id).length, photoN = listPhotos(a.id).length;
      const ok = await confirmDialog('删除个体',
        `将删除「${a.name}」及其全部关联数据：\n· 饲养日志 ${logN} 条\n· 照片 ${photoN} 张\n· 蛋记录 ${eggN} 颗\n· 相关待办将同步取消\n\n记账账单会保留但解除关联。此操作不可恢复！`,
        { okText: '确认删除', danger: true });
      if (!ok) return;
      await removeAnimal(a.id);
      toast('已删除', 'ok');
      App.go('#/animals');
    };

    const body = el.querySelector('#d-body');
    if (tab === 'overview') renderOverview(body, a, { cage, cagePlan, bills, eggs });
    else if (tab === 'logs') renderLogs(body, a);
    else if (tab === 'photos') renderPhotos(body, a);
    else renderBreeding(body, a, eggs);
  },
};

/* ---------------- 概况 ---------------- */
function renderOverview(body, a, { cage, cagePlan, bills, eggs }) {
  const info = [];
  const add = (k, v) => { if (v) info.push(`<div class="pv-row"><span class="k">${k}</span><span>${v}</span></div>`); };
  add('物种', esc(speciesName(a.speciesId) || '—'));
  add('编号', esc(a.code || '—'));
  add('性别', a.sex === 'male' ? '公' : a.sex === 'female' ? '母' : '未知');
  add('铲屎官', esc(a.keeper || '—'));
  add('购入日期', a.buyDate ? esc(a.buyDate.slice(0, 10)) : '');
  add('购入价格', a.buyPrice != null ? `¥${fmtMoney(a.buyPrice)}` : '');
  add('生日/出壳', a.birthDate ? esc(a.birthDate.slice(0, 10)) : '');
  add('最近体重', a.weight != null ? `${dispWeight(a.weight)} ${unitWeight()}` : '');
  add('最近体长', a.length != null ? `${dispLength(a.length)} ${unitLength()}` : '');
  add('所属爬箱', cage ? `${esc(cagePlan ? cagePlan.name : '')} · ${esc(cage.sizeType)}` : '');
  const fromEgg = a.fromEggId ? getEgg(a.fromEggId) : null;
  add('来源蛋', fromEgg ? `<a href="#/egg/${fromEgg.id}">${esc(fromEgg.code || '查看蛋记录')}</a>（${esc(fromEgg.layDate || '')} 产）` : '');
  add('母本累计产蛋', `${eggCountOfMother(a.id)} 颗`);
  add('创建时间', esc((a.createdAt || '').replace('T', ' ').slice(0, 16)));

  // 该个体的配对记录
  const pairings = listPairings(a.id);
  const pairingHtml = pairings.length ? pairings.map((p) => {
    const res = PAIR_RESULTS[p.result] || PAIR_RESULTS.pending;
    const others = (p.participants || []).filter((x) => x !== a.id).map((x) => `<a href="#/animal/${x}">${esc(animalName(x) || '已删除个体')}</a>`).join('、');
    return `<div class="pv-row"><span class="k">${esc(p.pairDate || '')}</span><span>与 ${others} <span class="st ${res.cls}">${res.label}</span>${p.note ? ` · ${esc(p.note)}` : ''}</span></div>`;
  }).join('') : `<div class="hint">暂无配对记录</div>`;

  body.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0;margin-bottom:14px">
      <h3 style="margin-bottom:8px">基础档案</h3>
      <div class="cage-preview">${info.join('')}</div>
    </div>
    ${a.note ? `<div class="card" style="box-shadow:none;padding:0;margin-bottom:14px"><h3 style="margin-bottom:8px">备注</h3><div style="font-size:13px;line-height:1.8;white-space:pre-wrap">${esc(a.note)}</div></div>` : ''}
    <div class="card" style="box-shadow:none;padding:0;margin-bottom:14px">
      <div class="card-head"><h3>配对记录</h3><button class="btn ghost sm" id="btn-pair-all">全部记录</button></div>
      <div class="cage-preview">${pairingHtml}</div>
    </div>
    <div class="card" style="box-shadow:none;padding:0;margin-bottom:14px">
      <div class="card-head"><h3>体重 / 体长趋势</h3><button class="btn ghost sm" id="btn-export-trend">📷 导出图片</button></div>
      <div id="trend-box"></div>
    </div>
    ${bills.length ? `<div class="card" style="box-shadow:none;padding:0">
      <h3 style="margin-bottom:8px">关联账单</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>类型</th><th>分类</th><th class="num">金额</th></tr></thead>
      <tbody>${bills.slice(0, 8).map((b) => `<tr><td>${esc(b.date)}</td><td>${b.type === 'income' ? '收入' : '支出'}</td><td>${esc(b.category)}</td><td class="num" style="color:${b.type === 'income' ? 'var(--income)' : 'var(--expense)'}">${b.type === 'income' ? '+' : '-'}¥${fmtMoney(b.amount)}</td></tr>`).join('')}</tbody></table></div>
    </div>` : ''}
  `;
  renderTrend(body.querySelector('#trend-box'), a);
  body.querySelector('#btn-export-trend').onclick = () => exportTrend(a);
  const pairAll = body.querySelector('#btn-pair-all');
  if (pairAll) pairAll.onclick = () => App.go('#/pairings');
}

function renderTrend(box, a) {
  const ms = listLogs(a.id, 'measure').slice().reverse(); // 正序
  const wPts = ms.filter((l) => l.data.weight != null).map((l) => ({ x: (l.createTime || '').slice(5, 10), y: Number(dispWeight(l.data.weight)) }));
  const lPts = ms.filter((l) => l.data.length != null).map((l) => ({ x: (l.createTime || '').slice(5, 10), y: Number(dispLength(l.data.length)) }));
  box.innerHTML = `
    <div style="font-size:12.5px;color:var(--muted);margin:6px 0 2px">体重（${unitWeight()}）· ${wPts.length} 个记录点</div>
    <div class="chart-wrap">${lineChart({ points: wPts, color: '#2e9e6b', unit: unitWeight() })}</div>
    <div style="font-size:12.5px;color:var(--muted);margin:14px 0 2px">体长（${unitLength()}）· ${lPts.length} 个记录点</div>
    <div class="chart-wrap">${lineChart({ points: lPts, color: '#e8912d', unit: unitLength() })}</div>`;
}

function exportTrend(a) {
  const ms = listLogs(a.id, 'measure').slice().reverse();
  const wPts = ms.filter((l) => l.data.weight != null).map((l) => ({ x: (l.createTime || '').slice(5, 10), y: Number(dispWeight(l.data.weight)) }));
  const lPts = ms.filter((l) => l.data.length != null).map((l) => ({ x: (l.createTime || '').slice(5, 10), y: Number(dispLength(l.data.length)) }));
  const c1 = lineChart({ points: wPts, color: '#2e9e6b', unit: unitWeight(), width: 680, height: 210 }).replace('<svg ', '<svg x="0" y="46" width="680" height="210" ');
  const c2 = lineChart({ points: lPts, color: '#e8912d', unit: unitLength(), width: 680, height: 210 }).replace('<svg ', '<svg x="0" y="300" width="680" height="210" ');
  const svg = `<svg viewBox="0 0 680 540" xmlns="http://www.w3.org/2000/svg">
    <rect width="680" height="540" fill="#ffffff"/>
    <text x="20" y="28" fill="#222" font-size="17" font-weight="700" font-family="sans-serif">${a.name} · 体重体长趋势</text>
    ${c1}${c2}
  </svg>`;
  const tmp = document.createElement('div');
  tmp.innerHTML = svg;
  tmp.style.position = 'fixed'; tmp.style.left = '-9999px';
  document.body.appendChild(tmp);
  const svgEl = tmp.querySelector('svg');
  svgToPng(svgEl, `${a.name}-趋势图.png`, { bg: '#ffffff', scale: 2 });
  setTimeout(() => tmp.remove(), 1500);
}

/* ---------------- 日志 ---------------- */
function renderLogs(body, a) {
  const state = { type: '', checked: new Set() };
  body.innerHTML = `
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn sm" data-add="feed">🍽️ 喂食</button>
      <button class="btn sm" data-add="medical">💉 医疗</button>
      <button class="btn sm" data-add="measure">⚖️ 体重体长</button>
    </div>
    <div class="seg" id="lg-filter">${[
      { v: '', l: '全部' }, { v: 'feed', l: '🍽️ 喂食' }, { v: 'medical', l: '💉 医疗' }, { v: 'measure', l: '⚖️ 体重体长' },
    ].map((x) => `<div class="seg-item ${x.v === '' ? 'active' : ''}" data-type="${x.v}">${x.l}</div>`).join('')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:10px 0 8px">
      <span style="color:var(--muted);font-size:12px" id="lg-count"></span>
      <button class="btn ghost sm" id="lg-selall">☑ 全选</button>
    </div>
    <div id="lg-batch"></div>
    <div class="list" id="lg-list"></div>`;

  body.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = async () => {
      const ok = await logModal(a.id, b.dataset.add);
      if (ok) { toast('已记录', 'ok'); App.refresh(); }
    };
  });
  body.querySelector('#lg-filter').addEventListener('click', (e) => {
    const item = e.target.closest('.seg-item');
    if (!item) return;
    body.querySelectorAll('#lg-filter .seg-item').forEach((x) => x.classList.remove('active'));
    item.classList.add('active');
    state.type = item.dataset.type;
    state.checked.clear();
    renderLogList();
  });

  function renderLogList() {
    const logs = listLogs(a.id, state.type);
    const box = body.querySelector('#lg-list');
    const countEl = body.querySelector('#lg-count');
    const selAllBtn = body.querySelector('#lg-selall');
    const ids = logs.map((l) => l.id);
    const allChecked = ids.length > 0 && ids.every((id) => state.checked.has(id));
    countEl.textContent = `共 ${logs.length} 条`;
    if (selAllBtn) {
      selAllBtn.textContent = allChecked ? '☑ 取消全选' : '☑ 全选';
      selAllBtn.style.display = ids.length ? '' : 'none';
      selAllBtn.onclick = () => {
        if (allChecked) ids.forEach((id) => state.checked.delete(id));
        else ids.forEach((id) => state.checked.add(id));
        renderLogList();
      };
    }
    const batchBox = body.querySelector('#lg-batch');
    if (state.checked.size) {
      batchBox.innerHTML = `<div class="log-batch-bar">
        <span class="lbb-count">已选 ${state.checked.size} 条</span>
        <button class="btn ghost sm" id="lg-batch-del" style="color:var(--danger)">🗑 批量删除</button>
        <button class="btn ghost sm" id="lg-batch-cancel">取消选择</button>
      </div>`;
      batchBox.querySelector('#lg-batch-cancel').onclick = () => { state.checked.clear(); renderLogList(); };
      batchBox.querySelector('#lg-batch-del').onclick = async () => {
        const n = state.checked.size;
        const ok = await confirmDialog('批量删除日志', `将删除已选中的 ${n} 条日志，删除后不可恢复。确定删除？`, { okText: '删除', danger: true });
        if (!ok) return;
        for (const id of [...state.checked]) await removeLog(id);
        state.checked.clear();
        toast(`已删除 ${n} 条日志`, 'ok');
        App.refresh();
      };
    } else batchBox.innerHTML = '';
    if (!logs.length) { box.innerHTML = emptyTip('📝', '暂无日志'); return; }
    box.innerHTML = logs.map((l) => {
      const cfg = LOG_TYPES[l.logType] || LOG_TYPES.feed;
      let txt = '';
      if (l.logType === 'feed') txt = `${esc(l.data.food || '')}${l.data.qty ? ' × ' + esc(l.data.qty) : ''}${l.data.ate ? ' · ' + esc(l.data.ate) : ''}${l.data.note ? ' · ' + esc(l.data.note) : ''}`;
      else if (l.logType === 'medical') txt = `${esc(l.data.symptom || '')}${l.data.treatment ? ' → ' + esc(l.data.treatment) : ''}${l.data.note ? ' · ' + esc(l.data.note) : ''}`;
      else txt = `${l.data.weight != null ? dispWeight(l.data.weight) + unitWeight() : ''}${l.data.weight != null && l.data.length != null ? ' / ' : ''}${l.data.length != null ? dispLength(l.data.length) + unitLength() : ''}${l.data.note ? ' · ' + esc(l.data.note) : ''}`;
      return `<div class="row" style="cursor:default">
        <input type="checkbox" class="log-check" data-id="${l.id}" ${state.checked.has(l.id) ? 'checked' : ''} title="选择此记录">
        <div class="animal-thumb" style="font-size:20px">${cfg.icon}</div>
        <div class="row-main">
          <div class="row-title" style="font-size:14px">${cfg.label}</div>
          <div class="row-sub">${txt || '—'}</div>
          <div class="row-sub" style="margin-top:2px">${esc(l.createTime || '')}</div>
        </div>
        <div class="row-side" style="white-space:nowrap">
          <button class="btn ghost sm" data-edit="${l.id}" title="修改此记录">修改</button>
          <button class="btn ghost sm" data-del="${l.id}" style="color:var(--danger)" title="删除此记录">删除</button>
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('.log-check').forEach((cb) => {
      cb.onchange = () => {
        if (cb.checked) state.checked.add(cb.dataset.id);
        else state.checked.delete(cb.dataset.id);
        renderLogList();
      };
    });
    box.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = async () => {
        const l = listLogs(a.id).find((x) => x.id === b.dataset.edit);
        if (!l) return;
        const ok = await logFormModal({ animalId: a.id, type: l.logType, log: l, speciesId: a.speciesId || '' });
        if (ok) App.refresh();
      };
    });
    box.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const ok = await confirmDialog('删除日志', '确定删除这条日志吗？', { okText: '删除', danger: true });
        if (!ok) return;
        await removeLog(b.dataset.del);
        toast('已删除');
        App.refresh();
      };
    });
  }
  renderLogList();
}

/* ---------------- 照片 ---------------- */
function renderPhotos(body, a) {
  const photos = listPhotos(a.id);
  body.innerHTML = `
    <input type="file" id="ph-input" accept="image/*" multiple style="display:none">
    <div class="photo-grid" id="ph-grid">
      ${photos.map((p) => `
        <div class="photo-cell" data-id="${p.id}">
          <img src="${p.full}" alt="">
          <div class="ph-acts">
            <button class="${p.isThumbnail ? 'thumb-on' : ''}" data-act="thumb">${p.isThumbnail ? '✓ 缩略图' : '设为缩略图'}</button>
            <button data-act="del" style="color:#c0392b">删除</button>
          </div>
        </div>`).join('')}
      ${photos.length < 3 ? `<div class="photo-cell ph-add" id="ph-add">＋</div>` : ''}
    </div>
    <div class="hint" style="margin-top:10px">最多 3 张照片；上传后自动压缩（长边 ≤1440px），画质保持清晰；首张默认为缩略图，可手动指定。</div>`;

  const input = body.querySelector('#ph-input');
  const addBtn = body.querySelector('#ph-add');
  if (addBtn) addBtn.onclick = () => input.click();
  input.onchange = async () => {
    const files = [...input.files];
    let added = 0;
    for (const f of files) {
      if (listPhotos(a.id).length >= 3) break;
      try {
        const { full, thumb } = await compressPhoto(f);
        await addPhoto(a.id, { full, thumb });
        added += 1;
      } catch (err) { toast(err.message, 'err'); }
    }
    if (added) { toast(`已上传 ${added} 张`, 'ok'); App.refresh(); }
  };
  body.querySelectorAll('.photo-cell[data-id]').forEach((cell) => {
    const id = cell.dataset.id;
    cell.querySelector('[data-act="thumb"]').onclick = async () => { await setThumbnail(a.id, id); toast('已设为缩略图', 'ok'); App.refresh(); };
    cell.querySelector('[data-act="del"]').onclick = async () => {
      const ok = await confirmDialog('删除照片', '确定删除这张照片吗？', { okText: '删除', danger: true });
      if (!ok) return;
      await removePhoto(id);
      App.refresh();
    };
  });
}

/* ---------------- 繁殖 ---------------- */
function renderBreeding(body, a, eggs) {
  const isMale = a.sex === 'male'; // 公个体不记录产蛋
  // 父本仅显示同物种个体（跨物种不配对）
  const fathers = S.animal.filter((x) => x.id !== a.id && x.speciesId === a.speciesId && (x.sex === 'male' || x.sex === 'unknown'));
  body.innerHTML = `
    <div class="btn-row" style="margin-bottom:12px">
      ${isMale ? '' : '<button class="btn" id="btn-add-egg">🥚 记录产蛋</button>'}
      <button class="btn ghost" id="btn-goto-predict">🧬 基因配对预测</button>
    </div>
    <div class="hint" style="margin-bottom:12px">${isMale
      ? '公个体不记录产蛋；如需记录请先将性别改为「母」或「未知」。'
      : `作为母本累计产蛋 <b>${eggs.length}</b> 颗；每颗蛋独立档案，破壳后可从蛋详情登记为「已孵化」。`}</div>
    ${eggs.length ? `<div class="egg-grid">${eggs.map((e) => `
      <div class="egg-card" data-egg="${e.id}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="eg-id">${esc(e.code || '')} · ${esc(e.layDate || '未知日期')}</span>${eggStatusBadge(e)}
        </div>
        <div class="eg-meta">预计破壳：${esc(e.expectHatchDate || '—')}<br>${e.isArchived ? '已归档' : '进行中'}</div>
      </div>`).join('')}</div>` : emptyTip('🥚', isMale ? '公个体无产蛋记录' : '暂无产蛋记录')}
  `;
  body.querySelector('#btn-goto-predict').onclick = () => App.go('#/predict');
  body.querySelectorAll('[data-egg]').forEach((c) => { c.onclick = () => App.go('#/egg/' + c.dataset.egg); });
  const addEggBtn = body.querySelector('#btn-add-egg');
  if (addEggBtn) addEggBtn.onclick = async () => {
    const res = await runModal({
      title: '记录产蛋',
      bodyHtml: `
        <div class="hint" style="margin-bottom:10px">母本：${esc(a.name)}${a.sex !== 'female' ? '（注意：该个体性别不是母）' : ''}</div>
        <div class="field"><label>父本</label><select id="eg-father"><option value="">未填写</option>${fathers.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>产蛋日期</label><input type="date" id="eg-lay" value="${todayStr()}"></div>
        <div class="field"><label>蛋状态</label><select id="eg-status">${[
          ['fertile', '受精'], ['infertile', '无精'], ['moldy', '发霉'], ['addled', '瘪蛋'],
        ].map(([v, l]) => `<option value="${v}" ${v === 'fertile' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>孵化温度（℃）</label><input type="number" id="eg-temp" min="10" max="35" step="0.5" placeholder="例如 22 / 23 / 24 / 25"><div class="hint" id="eg-temp-hint">22℃→90天、23℃→80天、24℃→70天、25℃→60天 自动计算破壳日；其他温度请手动填写</div></div>
        <div class="field"><label>预计破壳日期</label><input type="date" id="eg-hatch"><div class="hint">受精蛋填写后自动生成首页破壳待办</div></div>
        <div class="field"><label>产蛋数（颗）</label><input type="number" id="eg-count" value="1" min="1" max="30"></div>
        <div class="field"><label>备注</label><input type="text" id="eg-note" placeholder="例如：一窝第 2 颗"></div>`,
      buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
      mount: (mask) => {
        const temp = mask.querySelector('#eg-temp'), hatch = mask.querySelector('#eg-hatch'), lay = mask.querySelector('#eg-lay'), hint = mask.querySelector('#eg-temp-hint');
        const recalc = () => {
          const t = Number(temp.value);
          const days = HATCH_TEMP_DAYS[t];
          if (days) {
            hatch.value = addDays(lay.value || todayStr(), days);
            hint.textContent = `已按 ${t}℃ × ${days} 天自动计算，可手动修改`;
          } else {
            hint.textContent = '22℃→90天、23℃→80天、24℃→70天、25℃→60天 自动计算破壳日；其他温度请手动填写';
          }
        };
        temp.oninput = recalc;
        lay.onchange = recalc;
      },
    });
    if (!res) return;
    const v = (id) => (document.getElementById(id) || {}).value || '';
    const count = Math.min(30, Math.max(1, +v('eg-count') || 1));
    // 先读取全部输入值（弹窗关闭后 DOM 即被移除，循环内再读会丢值）
    const eggData = {
      motherId: a.id,
      fatherId: v('eg-father') || null,
      speciesId: a.speciesId,
      status: v('eg-status'),
      layDate: v('eg-lay') || todayStr(),
      temp: v('eg-temp') === '' ? null : Number(v('eg-temp')),
      expectHatchDate: v('eg-hatch'),
      note: v('eg-note'),
    };
    let autoTodo = false;
    for (let i = 0; i < count; i++) {
      const row = await createEgg({
        ...eggData,
        note: count > 1 ? (eggData.note ? `${eggData.note}（第 ${i + 1} 颗）` : `一窝第 ${i + 1} 颗`) : eggData.note,
      });
      if (row.expectHatchDate && row.status === 'fertile') autoTodo = true;
    }
    toast(`已记录 ${count} 颗蛋` + (autoTodo ? '，破壳待办已生成' : ''), 'ok');
    App.refresh();
  };
}

/* ---------------- 族谱（v2.6：名字行入口 + 弹窗展示，含全屏放大） ---------------- */
// 构建三代树状图 SVG 内容（自己 + 往上三代 + 子代 + 同窝个体）
// v2.7：画布宽度自适应——W 为容器可用宽度；叶子多、内容放不下时加宽画布（弹窗内横向滚动），
//       节点不再溢出 viewBox 右缘被裁切（旧版固定 680 宽，4 叶树最右节点会超出 ~24px），
//       手机端也不再被整体压缩到 0.47 倍导致文字不可读。
function pedigreeTree(a, W = 680) {
  const clutch = clutchAnimals(a.id);
  const children = S.animal.filter((x) => x.motherId === a.id || x.fatherId === a.id);

  /* --- 构建向上三代树 --- */
  const mkNode = (animal, gen, parent) => ({ animal, gen, parent, kids: [] });
  const root = mkNode(a, 0, null);
  const addUp = (n, depth) => {
    if (depth >= 3) return; // 自己 + 往上三代
    [n.animal.motherId, n.animal.fatherId].forEach((pid) => {
      const p = pid ? S.animal.find((x) => x.id === pid) : null;
      if (!p) return;
      const child = mkNode(p, depth + 1, n);
      n.kids.push(child);
      addUp(child, depth + 1);
    });
  };
  addUp(root, 0);

  /* --- 布局：叶子从左到右占位，父节点居中于子女 --- */
  let leafX = 0;
  const nodes = [];
  const layout = (n, depth) => {
    n.depth = depth;
    nodes.push(n);
    if (!n.kids.length) n.x = leafX++;
    else { n.kids.forEach((k) => layout(k, depth + 1)); n.x = (n.kids[0].x + n.kids[n.kids.length - 1].x) / 2; }
  };
  layout(root, 0);
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const leaves = Math.max(leafX, 1);
  const NH = 36;
  const ROW = 66;
  const GAP = 14;
  const NW = leaves <= 2 ? 100 : leaves <= 4 ? 88 : leaves <= 6 ? 78 : 68;

  /* --- 自己下方的子代 + 同窝个体（先算数量，参与画布宽度计算） --- */
  const below = [
    ...children.map((x) => ({ x, kind: 'kid' })),
    ...clutch.map((x) => ({ x, kind: 'clutch' })),
  ];

  // 画布宽：至少容纳容器宽度；叶子/子代行放不下时加宽（弹窗 .chart-wrap 横向滚动）
  const need = leaves * NW + (leaves - 1) * GAP + 8;
  const belowNeed = below.length ? below.length * NW + (below.length - 1) * GAP + 8 : 0;
  const CW = Math.max(W, need, belowNeed);
  const colW = leaves > 1 ? (CW - NW) / (leaves - 1) : 0;
  const px = (n) => (leaves > 1 ? NW / 2 + n.x * colW : CW / 2);
  const py = (n) => 34 + (maxDepth - n.depth) * ROW; // depth 0 = 自己，在最底行
  nodes.forEach((n) => { n.cx = px(n); n.cy = py(n); });

  const sexTxt = (x) => (x.sex === 'male' ? '♂' : x.sex === 'female' ? '♀' : '?');
  const genTxt = (g) => (g === 0 ? '当前个体' : g === 1 ? '父母辈' : g === 2 ? '祖辈' : '曾祖辈');
  const short = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

  let g = '';
  // 连线（肘线：先下后横再下）
  nodes.forEach((n) => {
    n.kids.forEach((k) => {
      const my = (n.cy + NH / 2 + k.cy - NH / 2) / 2;
      g += `<path d="M${n.cx},${n.cy + NH / 2} V${my} H${k.cx} V${k.cy - NH / 2}" fill="none" stroke="#9fb8ad" stroke-width="1.3"/>`;
    });
  });
  // 祖先节点
  nodes.forEach((n) => {
    const isSelf = n.animal.id === a.id;
    const w = NW, h = NH, x = n.cx - w / 2, y = n.cy - h / 2;
    g += `<g class="ped-node" data-id="${n.animal.id}" style="cursor:pointer">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" style="fill:${isSelf ? '#2e9e6b' : 'var(--card)'}" stroke="#2e9e6b" stroke-width="${isSelf ? 1.8 : 1.2}"/>
      <text x="${n.cx}" y="${y + 15}" text-anchor="middle" font-size="11.5" font-weight="700" style="fill:${isSelf ? '#fff' : 'var(--ink)'}" font-family="sans-serif">${esc(short(n.animal.name, 6))} ${sexTxt(n.animal)}</text>
      <text x="${n.cx}" y="${y + 27}" text-anchor="middle" font-size="8.5" style="fill:${isSelf ? 'rgba(255,255,255,.85)' : 'var(--muted)'}" font-family="sans-serif">${esc(short(isSelf ? (n.animal.code || '当前个体') : (n.animal.code || genTxt(n.gen)), 11))}</text>
      <title>${esc(n.animal.name)} · ${esc(genTxt(n.gen))}${n.animal.code ? ' · ' + esc(n.animal.code) : ''}（点击查看详情）</title>
    </g>`;
  });

  /* --- 自己下方的子代 + 同窝个体（在画布内均布，间距不足时已通过加宽画布避免重叠） --- */
  const kidY = root.cy + ROW;
  if (below.length) {
    const n = below.length;
    const step = n > 1 ? Math.min(120, (CW - NW) / (n - 1)) : 0;
    below.forEach((it, i) => {
      const cx = n > 1 ? NW / 2 + i * step : CW / 2;
      const w = NW, h = NH, x = cx - w / 2, y = kidY - h / 2;
      const isClutch = it.kind === 'clutch';
      g += `<path d="M${root.cx},${root.cy + NH / 2} V${kidY - ROW / 2 - 8} H${cx} V${y}" fill="none" stroke="${isClutch ? '#e0b07a' : '#9fb8ad'}" stroke-width="1.2" stroke-dasharray="${isClutch ? '4 3' : '0'}"/>`;
      g += `<g class="ped-node" data-id="${it.x.id}" style="cursor:pointer">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" style="fill:var(--card)" stroke="${isClutch ? '#e8912d' : '#2e9e6b'}" stroke-width="1.2" stroke-dasharray="${isClutch ? '4 3' : '0'}"/>
        <text x="${cx}" y="${y + 15}" text-anchor="middle" font-size="11.5" font-weight="700" style="fill:var(--ink)" font-family="sans-serif">${esc(short(it.x.name, 6))} ${sexTxt(it.x)}</text>
        <text x="${cx}" y="${y + 27}" text-anchor="middle" font-size="8.5" style="fill:var(--muted)" font-family="sans-serif">${esc(short(isClutch ? '同窝 · ' + (it.x.code || '') : it.x.code || '子代', 11))}</text>
        <title>${esc(it.x.name)} · ${isClutch ? '同窝个体' : '子代'}${it.x.code ? ' · ' + esc(it.x.code) : ''}（点击查看详情）</title>
      </g>`;
    });
  }
  const svgH = below.length ? kidY + NH / 2 + 26 : root.cy + NH / 2 + 26;
  return { g, svgH, canvasW: CW, clutchN: clutch.length, belowN: below.length, hasAncestor: nodes.length > 1 };
}

// 谱系弹窗（v2.6：从名字行最右侧「🧬 谱系」按钮打开；v2.7：画布自适应 + 工具条放大按钮）
async function pedigreeModal(a) {
  let onResize = null;
  const res = await runModal({
    title: `${a.name} 的族谱`,
    bodyHtml: `
      <div class="hint" style="margin-bottom:10px;line-height:1.8">
        ${pedHintOf(a)}
      </div>
      <div class="ped-toolbar">
        <div class="legend" style="margin:0">
          <span class="lg"><span class="tag-dot" style="background:#2e9e6b"></span>当前个体</span>
          <span class="lg"><span class="tag-dot" style="background:#fff;border:1px solid #2e9e6b"></span>直系亲属</span>
          <span class="lg" id="pedm-clutch-lg" hidden><span class="tag-dot" style="background:#e8912d"></span>同窝个体</span>
        </div>
        <button class="btn ghost sm" id="pedm-zoom" title="放大查看族谱">⤢ 放大查看</button>
      </div>
      <div class="pedigree chart-wrap" id="pedm-chart">
        <svg id="pedm-svg" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
      <div class="hint" style="margin-top:8px">点击节点可进入对应个体详情；树图过宽时可左右滑动查看。</div>`,
    buttons: [{ text: '关闭', cls: 'ghost', value: null }],
    mount(mask) {
      const wrap = mask.querySelector('#pedm-chart');
      const svg = mask.querySelector('#pedm-svg');
      const draw = () => {
        // 容器可用宽度（弹窗内容区；手机约 318、桌面约 424）
        const W = Math.max(240, wrap.clientWidth || 680);
        const t = pedigreeTree(a, W);
        svg.setAttribute('viewBox', `0 0 ${t.canvasW} ${t.svgH}`);
        svg.innerHTML = t.g;
        // 内容宽于容器 → 按自然宽度渲染并靠 .chart-wrap 横向滚动；否则满宽 1:1 显示
        svg.style.width = t.canvasW > W ? `${t.canvasW}px` : '100%';
        const lg = mask.querySelector('#pedm-clutch-lg');
        if (lg) lg.hidden = !t.clutchN;
        svg.dataset.w = String(t.canvasW);
        svg.dataset.h = String(t.svgH);
      };
      draw();
      // 横竖屏切换 / 窗口尺寸变化时按新宽度重排
      onResize = () => { if (wrap.isConnected) draw(); };
      window.addEventListener('resize', onResize);
      mask.querySelectorAll('.ped-node').forEach((n) => {
        n.onclick = () => { App.go('#/animal/' + n.dataset.id); };
      });
      mask.querySelector('#pedm-zoom').onclick = (e) => {
        e.stopPropagation();
        openSvgViewer(svg, `${a.name} 的族谱`);
      };
    },
  });
  if (onResize) window.removeEventListener('resize', onResize);
  return res;
}

// 谱系弹窗顶部提示文案（抽出自 pedigreeModal，便于阅读）
function pedHintOf(a) {
  const t = pedigreeTree(a);
  return `${t.hasAncestor
    ? '树状图展示往上三代（父母辈 / 祖辈 / 曾祖辈）的血统；底部为子代与同窝个体。'
    : '尚未记录父母本信息，无法生成三代族谱——请在个体表单补全「母体 / 父体」。'}`
    + `${t.belowN ? '<br>同窝个体判定：同父同母的同胞，或与来源蛋同母本、同产蛋日期批次中孵出的个体。' : ''}`;
}
