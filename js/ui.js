// ui.js —— 页面公共组件
'use strict';

import { esc, todayStr, daysBetween } from './util.js';
import { STATUS, EGG_STATUS, speciesName, geneName, thumbOf, listTags } from './store.js';

export function pageHead(title, sub = '', actionsHtml = '') {
  return `<div class="page-head">
    <div><h1 class="page-title">${esc(title)}</h1>${sub ? `<div class="page-sub">${esc(sub)}</div>` : ''}</div>
    <div class="btn-row">${actionsHtml}</div>
  </div>`;
}

export function emptyTip(ico, text) {
  return `<div class="empty-tip"><span class="et-ico">${ico}</span>${esc(text)}</div>`;
}

export function sexIco(sex) {
  const map = { male: '<span class="sex-ico sex-m" title="公">♂</span>', female: '<span class="sex-ico sex-f" title="母">♀</span>', unknown: '<span class="sex-ico sex-u" title="未知">?</span>' };
  return map[sex] || map.unknown;
}

export function statusBadge(a) {
  const s = STATUS[a.status] || STATUS.normal;
  return `<span class="st ${s.cls}">${s.label}</span>`;
}

export function tagChipsHtml(animal) {
  return (animal.tagIds || []).map((tid) => {
    const t = listTags().find((x) => x.id === tid);
    return t ? `<span class="tag-chip" style="background:${t.color}">${esc(t.name)}</span>` : '';
  }).join('');
}

// 缩略图；opts.noZoom=true 时禁止点击放大（个体列表：点击缩略图应直接进入详情）
export function animalThumbHtml(animal, opts = {}) {
  const p = thumbOf(animal);
  const cls = `animal-thumb${opts.noZoom ? ' no-zoom' : ''}`;
  if (p) return `<div class="${cls}"><img src="${p.thumb}" alt=""></div>`;
  const ico = animal.speciesId === 'sp-hognose' ? '🐍' : '🦎';
  return `<div class="${cls}">${ico}</div>`;
}

export function animalSubLine(a) {
  const parts = [];
  if (a.code) parts.push(a.code);
  if (a.speciesId) parts.push(speciesName(a.speciesId));
  if ((a.geneIds || []).length) {
    const names = a.geneIds.map((gid) => geneName(gid)).filter(Boolean);
    if (names.length) parts.push(names.join('·'));
  }
  if (a.birthDate) parts.push(`生日 ${a.birthDate.slice(0, 10)}`);
  if (a.weight != null) parts.push('有体重记录');
  return parts.join(' · ');
}

export function animalRowHtml(a, opts = {}) {
  return `<div class="row" data-id="${a.id}">
    ${animalThumbHtml(a, opts)}
    <div class="row-main">
      <div class="row-title"><span class="rt-name" title="${esc(a.name)}">${esc(a.name)}</span>${sexIco(a.sex)} ${statusBadge(a)}</div>
      <div class="row-sub">${esc(animalSubLine(a))}</div>
      ${(a.tagIds || []).length ? `<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">${tagChipsHtml(a)}</div>` : ''}
    </div>
    <div class="row-side" style="color:var(--muted);font-size:18px">›</div>
  </div>`;
}

export function eggStatusBadge(e) {
  const s = EGG_STATUS[e.status] || EGG_STATUS.fertile;
  return `<span class="egg-st ${s.cls}">${s.label}</span>`;
}

export function deadlineMeta(deadline) {
  if (!deadline) return '';
  const left = daysBetween(todayStr(), deadline);
  let txt;
  if (left < 0) txt = `<span class="countdown overdue">已逾期 ${-left} 天</span>`;
  else if (left === 0) txt = '<span class="countdown soon">今天到期</span>';
  else txt = `<span class="countdown">还剩 ${left} 天</span>`;
  return `截止 ${deadline} · ${txt}`;
}

export function segHtml(items, active, dataKey) {
  return items.map((it) => `<div class="seg-item ${it.value === active ? 'active' : ''}" data-${dataKey}="${it.value}">${esc(it.label)}</div>`).join('');
}

export function fieldHtml(label, inner, opts = {}) {
  const req = opts.req ? '<span class="req">*</span>' : '';
  return `<div class="field ${opts.span2 ? 'span2' : ''}">
    <label>${esc(label)}${req}</label>${inner}
    ${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}
  </div>`;
}

/* ---------- 基因预测结果（v2.2：概率 / 基因性状 / 基因名称） ---------- */
// v2.5：名称逐段着色——仅「超级」段（红）/「隐」段（蓝）包 span，其余段原色
//       （如 莉莉白+隐缺黄 仅「隐缺黄」标蓝；性状列超级体为表达式 莉莉白+莉莉白）
const NAME_PART_STYLE = { super: 'color:#d92626;font-weight:700', hidden: 'color:#1a6fd4' };
// v3.4：采用登记复合名时，若其中某组分为隐性「仅携带不显现」，以蓝色小字标注，避免信息丢失
// v3.5：回退至 v3.3 语义 —— 组分中含隐性「仅携带」时不采用登记复合名，
//       故「仅携带」蓝字标注不再需要（carriedOnly 机制整体移除）。
export function outcomeNameHtml(row, opts = {}) {
  const parts = Array.isArray(row && row.nameParts) && row.nameParts.length ? row.nameParts : [{ t: row && row.name, c: '' }];
  // 段间以「+」连接（与引擎 name 字符串一致）；仅超级/隐段包色 span
  // v3.3：可点击 → 打开该名称对应基因的详情（opts.clickable 时）
  const main = parts.map((p) => {
    const st = NAME_PART_STYLE[p.c];
    const txt = st ? `<span style="${st}">${esc(p.t)}</span>` : esc(p.t);
    if (!opts.clickable) return txt;
    return `<a href="javascript:void(0)" class="gp-name-link" data-gp-name="${esc(p.t)}" title="查看该基因详情">${txt}</a>`;
  }).join('+');
  return main;
}
export function outcomeTableHtml(r, opts = {}) {
  const list = r && r.rows ? r.rows : [];
  const body = list.length
    ? list.map((row) => `<tr>
        <td class="gp-p">${esc(row.probText || '')}</td>
        <td>${esc(row.phenotype)}</td>
        <td>${outcomeNameHtml(row, opts)}${row.combo ? '<span class="gene-type-tag" style="color:var(--brand);border-color:var(--brand)">复合</span>' : ''}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="color:var(--muted);text-align:center">无可预测组合</td></tr>';
  const warns = (r && r.warnings ? r.warnings : []);
  return `
    <table class="gp-table">
      <thead><tr><th style="width:72px">概率</th><th>基因性状</th><th>基因名称</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${warns.length ? `<div class="warn-box" style="margin-top:10px">⚠️ ${warns.map(esc).join('<br>⚠️ ')}</div>` : ''}
    <div class="hint" style="margin-top:8px">性状 = 该后代携带 / 显现的基因组合（超级体记为表达式，如 莉莉白+莉莉白）；名称优先取基因库中已登记的复合基因名（如 缺黄 + 莉莉白 → 缺黄莉莉），未登记则沿用性状；隐性基因需双亲各传一个拷贝才表现，故仅携带时沿用「XX+隐YY」写法（如 白化 + 康达 → 康达+隐白化），不采用登记复合名。名称中「隐」表示隐性基因仅携带、不显现（如 隐缺黄，仅该段<span style="color:#1a6fd4">标蓝</span>）；「超级」为不完全显性双拷贝（超级体，仅该段<span style="color:#d92626">标红</span>）并伴随健康风险。概率按孟德尔遗传定律精确计算，仅供繁育参考。</div>`;
}

// 预测结果导出图（SVG → 调用方经 svgToPng 转 PNG）
// v2.5：名称逐段 tspan 着色——仅「超级」段（#d92626 红）/「隐」段（#1a6fd4 蓝），其余段原色
const SVG_PART_FILL = { super: '#d92626', hidden: '#1a6fd4' };
export function outcomeNameTspans(row) {
  const parts = Array.isArray(row && row.nameParts) && row.nameParts.length ? row.nameParts : [{ t: row && row.name, c: '' }];
  // 段间以「+」连接（与引擎 name 字符串一致）；仅超级/隐段带色标
  const main = parts.map((p) => {
    const fill = SVG_PART_FILL[p.c] || '#1e7a50';
    const bold = p.c === 'super' ? ' font-weight="700"' : '';
    return `<tspan fill="${fill}"${bold}>${esc(p.t)}</tspan>`;
  }).join('+');
  // v3.5：不再标注「仅携带不显现」组分（回退 v3.3 语义）
  return main;
}

// v2.8：导出图改为竖屏圆角卡片
//   · 竖屏比例（宽 480，高 ≥ 700），圆角卡片 + 柔和底色背景
//   · 头部品牌标题「养个爬」，其下为预测类型与配对摘要
//   · 底部固定声明：所有预测遵循孟德尔基因遗传学，仅供参考
export function outcomeSvg(r, { title = '基因配对预测', subtitle = '' } = {}) {
  const W = 480;
  const rows = (r && r.rows) ? r.rows : [];
  const warns = (r && r.warnings) ? r.warnings : [];
  const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : (s || ''));

  // 竖屏卡片：固定最小高度（保证 480×N 竖版比例），结果块在卡片内垂直居中
  const MIN_H = 700;
  const HEAD_H = 186;   // 头部 + 「预测结果」标签
  const FOOT_H = 62;    // 页脚（分隔线 + 免责声明）
  const FOOT_GAP = 26;  // 结果区与页脚之间留白
  const ROW_H = 62;
  // 警告文案按每行 26 字折行（完整显示，不截断）
  const warnLines = warns.map((w) => {
    const per = 26;
    const out = [];
    for (let i = 0; i < w.length; i += per) out.push(w.slice(i, i + per));
    return out.length ? out : [''];
  });
  const WARN_H = warnLines.length ? 8 + warnLines.reduce((n, l) => n + l.length * 18 + 2, 0) : 0;
  const blockH = rows.length * ROW_H + WARN_H;
  // 卡片总高：至少 MIN_H（竖版比例），行数多时向下延伸
  const H = Math.max(MIN_H, HEAD_H + blockH + FOOT_GAP + FOOT_H);
  const avail = H - HEAD_H - FOOT_GAP - FOOT_H;
  // 结果块在可用空间内垂直居中（上方留白最多 40px，避免大片空白）
  const blockTop = HEAD_H + Math.min(40, Math.max(0, Math.floor((avail - blockH) / 2)));

  let y = blockTop;
  let body = '';
  rows.forEach((row, i) => {
    const ry = y;
    const bg = i % 2 ? '#f6faf8' : '#fbfdfc';
    const boxH = ROW_H - 10;
    body += `<rect x="38" y="${ry}" width="404" height="${boxH}" rx="12" fill="${bg}"/>
      <rect x="38" y="${ry + 10}" width="3" height="${boxH - 20}" rx="1.5" fill="#2e9e6b"/>
      <text x="54" y="${ry + boxH / 2 - 2}" font-size="14.5" font-family="sans-serif">${outcomeNameTspans(row)}</text>
      <text x="54" y="${ry + boxH / 2 + 16}" font-size="11.5" fill="#8b9a92" font-family="sans-serif">${esc(clip(row.phenotype, 22))}</text>
      <text x="428" y="${ry + boxH / 2 + 5}" font-size="15" font-weight="700" fill="#2e9e6b" text-anchor="end" font-family="sans-serif">${esc(row.probText || '')}</text>`;
    y += ROW_H;
  });
  if (!rows.length) {
    body += `<text x="240" y="${y + 10}" font-size="13" fill="#9aa8a1" text-anchor="middle" font-family="sans-serif">无可预测组合</text>`;
    y += 30;
  }
  if (warnLines.length) {
    y += 8;
    warnLines.forEach((lines) => {
      lines.forEach((ln, li) => {
        body += `<text x="${li === 0 ? 42 : 58}" y="${y}" font-size="11.5" fill="#b33025" font-family="sans-serif">${li === 0 ? '⚠ ' : ''}${esc(ln)}</text>`;
        y += 18;
      });
      y += 2;
    });
  }

  // 页脚：分隔线 + 免责声明（固定在卡片最下端）
  const footY = H - FOOT_H + 4;
  // v2.9：SVG 根显式声明 width/height 并锁定字体栈
  //   此前只给 viewBox：不同 WebView 在 <img> 加载 SVG 时对「无尺寸 SVG」的
  //   固有尺寸推断不一致（部分引擎按 300×150 默认值渲染），导致手机端导出的
  //   PNG 与电脑端视觉不同。显式尺寸 + 字体栈让两端逐像素一致。
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
    width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
    font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', sans-serif">
    <rect width="${W}" height="${H}" fill="#eef4f1"/>
    <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="24" fill="#ffffff" stroke="#dde9e3"/>
    <rect x="42" y="44" width="44" height="44" rx="13" fill="#2e9e6b"/>
    <text x="64" y="74" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="sans-serif">养</text>
    <text x="100" y="66" font-size="21" font-weight="700" fill="#1e7a50" font-family="sans-serif">养个爬</text>
    <text x="100" y="86" font-size="11" fill="#9aa8a1" letter-spacing="1" font-family="sans-serif">REPTILE BREEDING</text>
    <text x="42" y="122" font-size="15.5" font-weight="700" fill="#25302b" font-family="sans-serif">${esc(clip(title, 24))}</text>
    <text x="42" y="143" font-size="11.5" fill="#7d8c84" font-family="sans-serif">${esc(clip(subtitle || '概率估算仅供繁育参考', 34))}</text>
    <line x1="42" y1="160" x2="${W - 42}" y2="160" stroke="#e8efeb"/>
    <text x="42" y="178" font-size="12" font-weight="700" fill="#2e9e6b" font-family="sans-serif">预测结果</text>
    ${body}
    <line x1="42" y1="${footY - 14}" x2="${W - 42}" y2="${footY - 14}" stroke="#e8efeb"/>
    <text x="240" y="${footY + 14}" font-size="12" fill="#9aa8a1" text-anchor="middle" font-family="sans-serif">所有预测遵循孟德尔基因遗传学，仅供参考</text>
    <text x="240" y="${footY + 36}" font-size="10" fill="#c2cdc8" text-anchor="middle" font-family="sans-serif">养个爬 · 基因预测</text>
  </svg>`;
}
