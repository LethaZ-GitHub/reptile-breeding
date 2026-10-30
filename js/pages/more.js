// pages/more.js —— 移动端「更多」导航页
// v2.9：关于卡片新增「版本信息」按钮，点击弹窗展示更新内容；
//        更新内容正文来自项目根目录的「更新日志.txt」（打包进 assets/public/更新日志.txt），
//        用户可直接改该 txt 而无需改代码。
'use strict';

import { App } from '../app.js';
import { pageHead } from '../ui.js';
import { esc, runModal } from '../util.js';
import { APP_VERSION } from '../version.js';

const LINKS = [
  { ico: '🏡', label: '爬柜方案', route: '#/cages' },
  { ico: '📈', label: '成长记录', route: '#/growth' },
  { ico: '📖', label: '饲养日志', route: '#/logs' },
  // v3.3：补齐缺失入口（工单管理）
  { ico: '📋', label: '工单管理', route: '#/todos' },
  // v2.7：记账入口从底部菜单迁入此处（原位为配对记录，已移入底部菜单），改名「记账报表」
  // v3.4：月度报表已集成进记账报表，不再单独设入口
  { ico: '💰', label: '记账报表', route: '#/bills' },
  { ico: '🧬', label: '基因预测', route: '#/predict' },
  { ico: '📚', label: '基因库', route: '#/genes' },
  { ico: '🔬', label: '物种库', route: '#/species' },
  { ico: '🏷️', label: '标签管理', route: '#/tags' },
  { ico: '💾', label: '备份与恢复', route: '#/backup' },
  { ico: '📤', label: '个体分享', route: '#/share' },
  { ico: '⚙️', label: '设置', route: '#/settings' },
];

// 兜底正文：txt 读取失败（如 file:// 直开）时仍能展示基本信息
const FALLBACK_ABOUT = [
  '养个爬 · 本地优先版',
  '所有数据仅存储在本机浏览器本地数据库中，不会上传任何服务器。',
  '跨设备迁移请使用「备份与恢复」导出全量备份包。',
].join('\n');

/* v3.6：一键加群 —— QQ 群号 */
const QQ_GROUP_NO = '1041684490';
/* v3.6：网页版加群页（原生桥不可用时的回退） */
const QQ_GROUP_WEB = 'https://qm.qq.com/cgi-bin/qm/qr?k=' + QQ_GROUP_NO;
/* 1.0.0 正式版：一键捐助 —— 爱发电主页 */
const DONATE_URL = 'https://afdian.com/a/c7h31';

/**
 * v3.6：一键加群。
 * 1) 原生 App：走 RBNative.joinQQGroup(群号) 唤起 QQ 客户端的群资料卡；
 * 2) 电脑端 / 无原生桥：打开网页版加群页。
 */
function joinQQGroup() {
  try {
    if (window.RBNative && typeof window.RBNative.joinQQGroup === 'function') {
      window.RBNative.joinQQGroup(QQ_GROUP_NO);
      return;
    }
  } catch (e) { /* 落到网页回退 */ }
  try {
    window.open(QQ_GROUP_WEB, '_blank');
  } catch (e) {
    try { window.location.href = QQ_GROUP_WEB; } catch (e2) { /* ignore */ }
  }
}

/**
 * 1.0.0 正式版：一键捐助。
 * 本软件全功能免费，若觉得有帮助可通过爱发电支持作者；
 * 电脑端 / 无原生桥均直接用浏览器新标签页打开（爱发电为网页服务，无需原生桥）。
 */
function openDonate() {
  try {
    window.open(DONATE_URL, '_blank');
  } catch (e) {
    try { window.location.href = DONATE_URL; } catch (e2) { /* ignore */ }
  }
}

let notesCache = null;   // { about, sections: [{version, lines[]}] }

/**
 * 读取「更新日志.txt」并解析。
 * 格式约定：
 *   ## 关于[ · 副标题] → 关于卡片正文（其后到下一个 ## 之前）
 *   ## v3.2.0          → 一个版本条目（标题 + 若干行）
 */
async function loadNotes() {
  if (notesCache) return notesCache;
  try {
    const res = await fetch('release-notes.txt', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const aboutLines = [];
    const sections = [];
    let cur = null;   // 当前所属分节
    let inAbout = false;
    let aboutTitle = '关于';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      // v3.5：标题判定放宽到「##」后无空格也算（如用户手写的「##www.」），
      //   但只有「关于」开头的才是关于段标题，其余仍按正文行处理。
      const m = /^##\s*(.*)$/.exec(line);
      if (m && /^\s*关于(\s*[·・\-—].*)?$/.test(m[1] || '')) {
        cur = { title: '关于', lines: aboutLines };
        aboutTitle = (m[1] || '关于').trim();
        inAbout = true;
        continue;
      }
      if (m && /^##\s+/.test(line)) {
        const head = m[1].trim();
        cur = { title: head, lines: [] };
        sections.push(cur);
        inAbout = false;
        continue;
      }
      if (!cur) continue;
      // v3.5：关于段保留空行（保持用户原文段落结构）；版本条目段跳过空行
      if (!line.trim()) {
        if (inAbout) cur.lines.push('');
        continue;
      }
      cur.lines.push(line.trim());
    }
    notesCache = {
      about: aboutLines.join('\n').trim() || FALLBACK_ABOUT,
      aboutTitle,
      sections,
    };
  } catch (e) {
    notesCache = { about: FALLBACK_ABOUT, aboutTitle: '关于', sections: [] };
  }
  return notesCache;
}

function notesHtml(notes) {
  const body = notes.sections.length
    ? notes.sections.map((s) => `<div class="ver-block">
        <div class="ver-title">${esc(s.title)}</div>
        ${s.lines.map((l) => `<div class="ver-line">· ${esc(l)}</div>`).join('')}
      </div>`).join('')
    : '<div class="hint">暂无更新记录</div>';
  return `<div class="ver-list">${body}</div>`;
}

/**
 * 关于卡片正文渲染：
 *  · **粗体** → <b>
 *  · 独立的「License」一词 → 变为可点击超链接（点击弹出完整协议）
 *  · 独立的「Version」/「版本信息」一词 → 也可点击（打开版本信息弹窗）
 */
function aboutHtml(text) {
  const lines = String(text || '').split('\n');
  return lines.map((line) => {
    let html = esc(line)
      .replace(/^#{1,2}\s*/, '')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s（(])License(?=$|[\s）),.，。])/g, '$1<a href="javascript:void(0)" class="about-link" id="about-license">License</a>');
    return `<div class="about-line">${html || '&nbsp;'}</div>`;
  }).join('');
}

/**
 * License 正文显示归一化（仅影响展示，磁盘 LICENSE 文件保持原文不动）。
 * Apache-2.0 原文用大段空格做居中排版，在手机窄屏配合 pre-wrap 会被拆得支离破碎。
 * 这里：① 行首连续空格压缩到最多 2 个（保留条款缩进层级）；② 行内连续空格压缩为 1 个。
 */
function normalizeLicenseText(text) {
  return String(text || '').split('\n').map((line) => {
    const indent = (line.match(/^[ \t]+/) || [''])[0];
    const body = line.slice(indent.length);
    const shortIndent = ' '.repeat(Math.min(indent.length, 2));
    return shortIndent + body.replace(/[ \t]{2,}/g, ' ');
  }).join('\n');
}

/** 读取并展示完整 License（Apache-2.0 + Commons Clause） */
async function showLicenseModal() {
  let text = '';
  try {
    const res = await fetch('license.txt', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  } catch (e) {
    text = '无法读取 License 文件（license.txt）。\n\n本项目采用 Apache License, Version 2.0 并附加 The Commons Clause 使用限制。';
  }
  await runModal({
    title: 'License · Apache-2.0 + Commons Clause',
    bodyHtml: `
      <div class="hint" style="margin-bottom:10px">本软件采用 Apache License 2.0，并附加 The Commons Clause（禁止直接销售本软件本身）使用限制。以下先列中文译文（仅供参考），后附英文原文（以英文原文为准）。</div>
      <pre class="license-text">${esc(normalizeLicenseText(text))}</pre>`,
    buttons: [{ text: '关闭', cls: 'ghost', value: null }],
  });
}

export default {
  title: '更多',
  async render(el) {
    const notes = await loadNotes();
    el.innerHTML = `
      ${pageHead('更多功能')}
      <div class="more-grid">
        ${LINKS.map((l) => `<div class="more-cell" data-route="${l.route}"><span class="mc-ico">${l.ico}</span>${l.label}</div>`).join('')}
      </div>
      <div class="card" style="margin-top:14px">
        <div class="card-head">
          <h3>${esc(notes.aboutTitle || '关于')}</h3>
          <div class="card-head-act">
            <!-- v3.6：新增「一键加群」按钮，位于「版本信息」按钮左侧 -->
            <button class="btn ghost sm" id="btn-join-qq" title="加入 QQ 群 ${QQ_GROUP_NO}">💬 一键加群</button>
            <!-- 1.0.0 正式版：「一键捐助」按钮，位于「一键加群」与「版本信息」之间 -->
            <button class="btn ghost sm" id="btn-donate" title="前往爱发电支持作者">💰 一键捐助</button>
            <button class="btn ghost sm" id="btn-version">ℹ️ 版本信息</button>
          </div>
        </div>
        <div class="about-body">${aboutHtml(notes.about)}</div>
        <div class="hint" style="margin-top:8px">
          本项目基于
          <a href="javascript:void(0)" class="about-link" id="about-license-link">Apache-2.0 + Commons Clause</a>
          协议发布 · <a href="javascript:void(0)" class="about-link" id="about-license-btn">查看完整 License</a>
        </div>
      </div>
    `;
    el.querySelectorAll('.more-cell').forEach((c) => { c.onclick = () => App.go(c.dataset.route); });
    const licLinks = el.querySelectorAll('#about-license, #about-license-link, #about-license-btn');
    licLinks.forEach((a) => { a.onclick = () => showLicenseModal(); });
    el.querySelector('#btn-join-qq').onclick = () => joinQQGroup();
    el.querySelector('#btn-donate').onclick = () => openDonate();
    el.querySelector('#btn-version').onclick = async () => {
      const n = await loadNotes();
      await runModal({
        title: '版本信息',
        bodyHtml: `<div class="ver-current">当前版本 <b>v${esc(APP_VERSION)}</b></div>${notesHtml(n)}`,
        buttons: [{ text: '关闭', cls: 'ghost', value: null }],
      });
    };
  },
};
