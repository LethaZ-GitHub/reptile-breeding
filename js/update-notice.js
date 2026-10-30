// update-notice.js —— 版本更新说明弹窗（v3.3）
//   · 每次版本更新后首次启动自动弹出，展示本次更新内容；
//   · 同一版本仅弹出一次（按版本号记录已读状态，存 localStorage）；
//   · 弹窗内容来自「更新日志.txt」（打包为 release-notes.txt），取当前版本对应段落。
'use strict';

import { esc, runModal } from './util.js';
import { APP_VERSION } from './version.js';

const SEEN_KEY = 'rb-update-seen-version';

/* 捐助链接（爱发电主页）—— 与安卓启动页 strings.xml 中的 splash_donate_url 保持一致 */
export const DONATE_LINK = 'https://afdian.com/a/c7h31';
export const DONATE_TEXT = '本软件全功能免费，若支持可捐助';

/* 更新日志正文缓存：{ about, sections: [{version, lines[]}] } */
let notesCache = null;

/**
 * 读取并解析 release-notes.txt
 *   ## 关于[ · 副标题] → 关于正文
 *   ## v3.3.0         → 版本条目
 */
export async function loadReleaseNotes() {
  if (notesCache) return notesCache;
  try {
    const res = await fetch('release-notes.txt', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const sections = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (/^##\s+/.test(line)) {
        const head = line.replace(/^##\s+/, '').trim();
        if (/^关于(\s*[·・\-—].*)?$/.test(head)) continue;   // 关于段落不参与版本匹配
        cur = { version: head.replace(/^v/i, '').trim(), title: head, lines: [] };
        sections.push(cur);
        continue;
      }
      if (!cur || !line.trim()) continue;
      cur.lines.push(line.trim());
    }
    notesCache = { sections };
  } catch (e) {
    notesCache = { sections: [] };
  }
  return notesCache;
}

/** 取指定版本的更新条目；找不到则返回 null */
export async function findVersionNotes(version) {
  const notes = await loadReleaseNotes();
  const v = String(version || '').replace(/^v/i, '').trim();
  return notes.sections.find((s) => s.version === v) || null;
}

/** 该版本是否已经弹过（已读） */
export function hasSeenVersion(version) {
  try { return localStorage.getItem(SEEN_KEY) === String(version); }
  catch (e) { return false; }
}

/** 标记该版本已读（同一版本不再重复弹出） */
export function markVersionSeen(version) {
  try { localStorage.setItem(SEEN_KEY, String(version)); }
  catch (e) { /* 隐私模式等 */ }
}

/**
 * 弹出更新说明弹窗
 * @param {object} [opts]
 * @param {string} [opts.version] 版本号（默认当前版本）
 * @param {string[]} [opts.lines] 更新条目（默认从更新日志中取）
 */
export async function showUpdateNotice(opts = {}) {
  const version = opts.version || APP_VERSION;
  let lines = opts.lines;
  if (!lines) {
    const sec = await findVersionNotes(version);
    lines = sec ? sec.lines : [];
  }
  await runModal({
    title: '养个爬',
    bodyHtml: `
      <div style="text-align:center;padding:2px 0 12px">
        <img src="icons/logo-g.png" alt="养个爬" style="width:88px;height:88px;object-fit:contain;display:inline-block">
        <div style="font-size:20px;font-weight:800;color:var(--brand);margin-top:4px">养个爬</div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">${esc(DONATE_TEXT)}</div>
        <div style="font-size:12px;color:var(--brand);margin-top:3px">
          ${DONATE_LINK
            ? `<a href="${esc(DONATE_LINK)}" target="_blank" rel="noopener" style="color:var(--brand)">${esc(DONATE_LINK)}</a>`
            : '<span style="color:var(--muted)">（捐助链接待补充）</span>'}
        </div>
      </div>
      <div class="upd-head">本次更新内容</div>
      <div class="upd-list">
        ${lines.length ? lines.map((l) => `<div class="upd-item">· ${esc(l)}</div>`).join('')
          : '<div class="upd-item" style="color:var(--muted)">本次更新暂无详细说明</div>'}
      </div>
      <div class="hint" style="text-align:center;margin-top:12px">当前版本 v${esc(version)}</div>`,
    buttons: [{ text: '知道了', value: 'ok' }],
  });
}

/**
 * 启动时调用：若当前版本尚未展示过更新说明，则弹出（同一版本仅一次）。
 * @returns {Promise<boolean>} 是否弹出了弹窗
 */
export async function maybeShowUpdateNotice() {
  const version = APP_VERSION;
  if (hasSeenVersion(version)) return false;
  // 先标记再弹：即使用户中途杀进程也不会反复弹出
  markVersionSeen(version);
  await showUpdateNotice({ version });
  return true;
}
