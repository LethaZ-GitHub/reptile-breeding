// verify-v36.mjs —— v3.6 五项需求专项验证
//   A. APP 图标主体居中（前景层按守宫视觉重心对齐 + 连通域去杂）
//   B. 基因预测选择基因框在手机端不超出屏幕
//   C. License 中文译文在前、英文原文在后
//   D. 版本信息按钮左侧存在「一键加群」按钮，点击调起 QQ 加群
//   E. 版本设为 1.0.0 首个正式版 + 更新内容为全功能介绍
//   F. 「一键捐助」按钮：启动页由文本链接改为按钮；关于页位于加群与版本信息之间；
//      链接为爱发电 https://afdian.com/a/c7h31；更新日志改为全功能简介
import { withBrowser } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3242';
// 项目根目录（fileURLToPath 正确处理中文路径与 Windows 盘符）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

await withBrowser(async (p) => {
  /* ===== A. APP 图标主体居中（静态检查 + 前景层几何验证） ===== */
  const resDir = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
  // 源目录用 mipmap-xxxhdpi（Gradle 打包时才补 -v4 后缀）
  const fgPath = path.join(resDir, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png');
  ok('A xxxhdpi 前景层位图存在', fs.existsSync(fgPath), fgPath);
  // 在浏览器里解码前景层 PNG，独立核算守宫在 108dp 画布内的位置（不依赖 Python）
  const fgB64 = fs.readFileSync(fgPath).toString('base64');
  const fg = await p.eval(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${fgB64}';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sx = 0, sy = 0, sw = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const a = d[(y * c.width + x) * 4 + 3];
        if (a > 40) {
          sx += x * a; sy += y * a; sw += a;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    return {
      w: c.width, h: c.height,
      cx: sx / sw, cy: sy / sw,
      bbox: [minX, minY, maxX, maxY],
    };
  })()`, { awaitPromise: true });
  console.log('  前景层: ' + JSON.stringify(fg));
  const dx = Math.abs(fg.cx - fg.w / 2);
  const dy = Math.abs(fg.cy - fg.h / 2);
  // 质心与画布中心的偏差需在 3% 以内（432 画布上约 ±13px）
  ok('A 守宫视觉重心水平居中（偏差 < 3% 画布宽）', dx < fg.w * 0.03, `dx=${dx.toFixed(1)}px / ${fg.w}px`);
  ok('A 守宫视觉重心垂直居中（偏差 < 3% 画布高）', dy < fg.h * 0.03, `dy=${dy.toFixed(1)}px / ${fg.h}px`);
  // 前缀：前景层不得含有延伸到画布边缘的杂散像素（旧缺陷：bbox 被撑满）
  const bb = fg.bbox;
  ok('A 前景层守宫未延伸至画布边缘（无杂块污染）',
    bb[0] > 0 && bb[1] > 0 && bb[2] < fg.w - 1 && bb[3] < fg.h - 1,
    `bbox=${JSON.stringify(bb)} canvas=${fg.w}x${fg.h}`);
  // 生成脚本须含连通域去杂与质心对齐逻辑
  const mkIcons = fs.readFileSync(path.join(ROOT, 'tools', 'make-app-icons.py'), 'utf8');
  ok('A 图标脚本含最大连通域去杂逻辑', mkIcons.includes('largest_component'), '');
  ok('A 图标脚本按质心对齐画布中心', mkIcons.includes('mask_centroid') && mkIcons.includes('rcx_global'), '');

  /* ===== B. 基因预测选择基因框不超出屏幕（390×844 手机视口） ===== */
  await p.setViewport(390, 844, false);
  await p.goto(BASE + '#/predict', 2000);
  await sleep(1000);
  // 模拟多选 6 个基因（v3.5 起支持多选），此前会把触发器撑到 886px 宽
  const sel = await p.eval(`(() => {
    const vw = document.documentElement.clientWidth;
    const s = document.querySelector('#male-box select');
    if (!s) return { err: 'no select' };
    [...s.options].slice(0, 6).forEach(o => { o.selected = true; });
    s.dispatchEvent(new Event('change', { bubbles: true }));
    const tb = document.querySelector('#male-box .pk-btn');
    const b = tb.getBoundingClientRect();
    const row = tb.closest('.prob-row').getBoundingClientRect();
    return {
      vw,
      label: tb.querySelector('.pk-label').textContent,
      triggerW: Math.round(b.width),
      triggerR: Math.round(b.right),
      rowR: Math.round(row.right),
      bodyScrollW: document.body.scrollWidth,
      docScrollW: document.documentElement.scrollWidth,
    };
  })()`);
  console.log('  预测页: ' + JSON.stringify(sel));
  ok('B 多选后触发器宽度不超出视口', sel.triggerR <= sel.vw + 1, `right=${sel.triggerR} vw=${sel.vw}`);
  ok('B 多选后整行不超出视口', sel.rowR <= sel.vw + 1, `row.right=${sel.rowR} vw=${sel.vw}`);
  ok('B 页面无横向滚动', sel.docScrollW <= sel.vw + 1, `scrollW=${sel.docScrollW} vw=${sel.vw}`);
  ok('B 多选标签已折叠为摘要（含「等」）',
    sel.label.length < 60 && sel.label.includes('已选'), sel.label);
  // 弹层也不得超出屏幕
  await p.eval(`(() => { const b = document.querySelector('#male-box .pk-btn'); if (b) b.click(); })()`);
  await sleep(700);
  const sheet = await p.eval(`(() => {
    const vw = document.documentElement.clientWidth;
    const mo = document.querySelector('.modal-mask .modal');
    if (!mo) return { err: 'no sheet' };
    const b = mo.getBoundingClientRect();
    return { vw, l: Math.round(b.left), r: Math.round(b.right), sw: mo.scrollWidth, cw: mo.clientWidth };
  })()`);
  ok('B 多选弹层不超出屏幕', !sheet.err && sheet.r <= sheet.vw + 1 && sheet.sw <= sheet.cw + 1,
    JSON.stringify(sheet));

  /* ===== C. License 中文译文在前 ===== */
  const lic = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const licFlat = lic.replace(/\r\n/g, '\n');
  const cnIdx = licFlat.indexOf('中文译文');
  const enIdx = licFlat.indexOf('英文原文（English Original）');
  const apIdx = licFlat.indexOf('Apache 许可证（第 2.0 版）');
  const apEnIdx = licFlat.indexOf('Apache License\n                           Version 2.0');
  ok('C LICENSE 含中文译文段', cnIdx >= 0, '');
  ok('C LICENSE 含英文原文段', enIdx >= 0, '');
  ok('C 中文译文位于英文原文之前', cnIdx > 0 && enIdx > 0 && cnIdx < enIdx,
    `cn=${cnIdx} en=${enIdx}`);
  ok('C 中文 Apache 正文先于英文正文出现',
    apIdx >= 0 && apEnIdx >= 0 && apIdx < apEnIdx, `cnBody=${apIdx} enBody=${apEnIdx}`);
  ok('C 中英文段落均完整保留',
    licFlat.includes('附加条款：The Commons Clause') && licFlat.includes('The Commons Clause\n\n"Commons Clause"'),
    '');
  ok('C END OF TERMS 标记保留', licFlat.includes('END OF TERMS AND CONDITIONS'), '');

  /* ===== D. 一键加群按钮 ===== */
  await p.goto(BASE + '#/more', 1500);
  await sleep(700);
  const qq = await p.eval(`(() => {
    const join = document.querySelector('#btn-join-qq');
    const ver = document.querySelector('#btn-version');
    if (!join) return { err: 'no join btn' };
    const jb = join.getBoundingClientRect();
    const vb = ver ? ver.getBoundingClientRect() : null;
    return {
      text: join.textContent.trim(),
      title: join.getAttribute('title') || '',
      joinR: Math.round(jb.right),
      verL: vb ? Math.round(vb.left) : null,
      sameRow: vb ? Math.abs(jb.top - vb.top) < 12 : false,
      leftOfVersion: vb ? jb.right <= vb.left + 1 : false,
    };
  })()`);
  console.log('  一键加群: ' + JSON.stringify(qq));
  ok('D 存在「一键加群」按钮', !qq.err && qq.text.includes('一键加群'), JSON.stringify(qq));
  ok('D 按钮位于「版本信息」按钮左侧', qq.leftOfVersion === true, `joinR=${qq.joinR} verL=${qq.verL}`);
  ok('D 两按钮在同一行', qq.sameRow === true, '');
  // 群号正确性（静态检查源码）
  const moreJs = fs.readFileSync(path.join(ROOT, 'js', 'pages', 'more.js'), 'utf8');
  ok('D 群号为 1041684490', moreJs.includes('1041684490'), '');
  ok('D 点击走原生桥 joinQQGroup',
    moreJs.includes('RBNative.joinQQGroup') && moreJs.includes('joinQQGroup(QQ_GROUP_NO)'), '');
  // 原生层实现 + Manifest 可见性声明
  const java = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'reptile', 'breeding', 'MainActivity.java'), 'utf8');
  ok('D 原生层实现 joinQQGroup（mqqapi scheme）',
    java.includes('joinQQGroup') && java.includes('mqqapi://card/open_psgrcard?uin_group='), '');
  const manifest = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  ok('D Manifest 声明 QQ 包可见性（queries）',
    manifest.includes('<queries>') && manifest.includes('com.tencent.mobileqq'), '');

  /* ===== E. 1.0.0 正式版 + 全功能介绍 ===== */
  const verJs = fs.readFileSync(path.join(ROOT, 'js', 'version.js'), 'utf8');
  ok('E APP_VERSION = 1.0.0', /APP_VERSION\s*=\s*'1\.0\.0'/.test(verJs), '');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok('E package.json version = 1.0.0', pkg.version === '1.0.0', pkg.version);
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
  ok('E build.gradle versionCode = 28', /versionCode\s+28/.test(gradle), '');
  ok('E build.gradle versionName = 1.0', /versionName\s+"1\.0"/.test(gradle), '');
  // 更新日志当前版本段应为全功能介绍
  const notes = fs.readFileSync(path.join(ROOT, '更新日志.txt'), 'utf8');
  const v1Idx = notes.indexOf('## v1.0.0');
  const v35Idx = notes.indexOf('## v3.5.0');
  ok('E 更新日志含 v1.0.0 段', v1Idx >= 0, '');
  ok('E v1.0.0 为首个版本段（排最前）', v1Idx === notes.indexOf('## v'), `v1=${v1Idx}`);
  const v1Body = v1Idx >= 0 ? notes.slice(v1Idx, v35Idx > 0 ? v35Idx : undefined) : '';
  const lines = v1Body.split('\n').filter(l => l.trim() && !l.startsWith('##'));
  ok('E v1.0.0 更新内容条目充足（≥15 条全功能介绍）', lines.length >= 15, `实际 ${lines.length} 条`);
  const mustMention = ['个体档案', '饲养日志', '食物库', '繁殖管理', '基因预测', '基因库',
    '爬柜', '待办', '记账', '备份', '谱系', '正式版'];
  const missing = mustMention.filter(k => !v1Body.includes(k));
  ok('E v1.0.0 覆盖全部功能模块介绍', missing.length === 0, '缺少: ' + missing.join('、'));
  // 更新弹窗应展示该版本条目（server.js 服务项目根，/js/update-notice.js 可直接 import）
  const upd = await p.eval(`(async () => {
    const m = await import('/js/update-notice.js');
    const sec = await m.findVersionNotes('1.0.0');
    return { found: !!sec, count: sec ? sec.lines.length : 0, first: sec && sec.lines[0] };
  })()`, { awaitPromise: true });
  console.log('  更新弹窗: ' + JSON.stringify(upd));
  ok('E 更新弹窗能取到 v1.0.0 条目', upd.found === true && upd.count >= 15,
    `count=${upd.count}`);

  /* ===== F. 「一键捐助」按钮（启动页按钮化 + 关于页加按钮 + 爱发电链接） ===== */
  const DONATE_URL = 'https://afdian.com/a/c7h31';
  // F1. 关于页：按钮存在、位于「一键加群」与「版本信息」之间、点击打开爱发电
  await p.goto(BASE + '#/more', 1500);
  await sleep(700);
  const don = await p.eval(`(() => {
    const b = document.querySelector('#btn-donate');
    const j = document.querySelector('#btn-join-qq');
    const v = document.querySelector('#btn-version');
    if (!b) return { err: 'no donate btn' };
    const bb = b.getBoundingClientRect();
    const jb = j ? j.getBoundingClientRect() : null;
    const vb = v ? v.getBoundingClientRect() : null;
    const act = b.closest('.card-head-act');
    const ab = act ? act.getBoundingClientRect() : null;
    return {
      text: b.textContent.trim(),
      title: b.getAttribute('title') || '',
      between: !!(jb && vb) && jb.right <= bb.left + 1 && bb.right <= vb.left + 1,
      sameRow: !!(jb && vb) && Math.abs(bb.top - jb.top) < 12 && Math.abs(bb.top - vb.top) < 12,
      actR: ab ? Math.round(ab.right) : null,
      vw: document.documentElement.clientWidth,
    };
  })()`);
  console.log('  一键捐助: ' + JSON.stringify(don));
  ok('F 关于页存在「一键捐助」按钮', !don.err && don.text.includes('一键捐助'), JSON.stringify(don));
  ok('F 捐助按钮位于加群与版本信息之间', don.between === true, JSON.stringify(don));
  ok('F 三按钮同一行不溢出（手机视口）', don.sameRow === true && don.actR <= don.vw + 1,
    `actR=${don.actR} vw=${don.vw}`);
  // 点击行为：桩掉 window.open 后点击，校验打开的 URL（不真正跳转）
  await p.eval(`(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; })()`, { awaitPromise: false });
  await p.eval(`(() => { document.querySelector('#btn-donate').click(); })()`, { awaitPromise: false });
  const opened = await p.eval(`(() => window.__opened)()`);
  ok('F 点击捐助按钮打开爱发电链接', opened.includes(DONATE_URL), JSON.stringify(opened));
  // F2. more.js 源码：URL 常量与打开函数
  ok('F more.js 捐助 URL 与打开函数齐全',
    moreJs.includes(DONATE_URL) && moreJs.includes('openDonate') && moreJs.includes("id=\"btn-donate\""), '');
  // F3. 更新弹窗：捐助链接占位已填写且可点击
  const updJs = fs.readFileSync(path.join(ROOT, 'js', 'update-notice.js'), 'utf8');
  ok('F 更新弹窗 DONATE_LINK 已填爱发电', updJs.includes("DONATE_LINK = '" + DONATE_URL + "'"), '');
  ok('F 更新弹窗捐助链接渲染为可点击超链接',
    updJs.includes('target="_blank"') && updJs.includes('${esc(DONATE_LINK)}'), '');
  const donMod = await p.eval(`(async () => {
    const m = await import('/js/update-notice.js');
    return { link: m.DONATE_LINK, text: m.DONATE_TEXT };
  })()`, { awaitPromise: true });
  ok('F 更新弹窗模块导出捐助链接', donMod.link === DONATE_URL, JSON.stringify(donMod));
  // F4. 安卓启动页：文本链接 → 「一键捐助」按钮（静态检查）
  const strXml = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8');
  ok('F 启动页新增「一键捐助」按钮文案',
    strXml.includes('name="splash_donate_btn"') && strXml.includes('>一键捐助<'), '');
  ok('F 启动页捐助 URL 为爱发电',
    strXml.includes('name="splash_donate_url">' + DONATE_URL + '<'), '');
  ok('F 启动页移除旧占位文本链接（splash_donate_link）', !strXml.includes('splash_donate_link'), '');
  const splashXml = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'layout', 'activity_splash.xml'), 'utf8');
  ok('F 启动页布局捐助入口为 Button 且 id 正确',
    splashXml.includes('@+id/splashDonateBtn') && /<Button[\s\S]*?splashDonateBtn/.test(splashXml), '');
  ok('F 启动页布局不再有捐助文本链接节点', !splashXml.includes('splashDonateLink'), '');
  ok('F 捐助按钮圆角背景 drawable 存在',
    fs.existsSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash_donate_bg.xml')), '');
  ok('F MainActivity 点击捐助按钮走 ACTION_VIEW 打开链接',
    java.includes('R.id.splashDonateBtn') && java.includes('openExternalUrl')
    && java.includes('Intent.ACTION_VIEW') && java.includes('splash_donate_url'), '');
  // F5. 更新日志：v1.0.0 段为全功能简介且说明本次捐助按钮
  ok('F v1.0.0 更新日志说明「一键捐助」',
    v1Body.includes('一键捐助') && v1Body.includes('afdian.com'), '');
  ok('F v1.0.0 更新日志保持全功能简介定位',
    v1Body.includes('全功能') && v1Body.includes('简介'), '');

  /* ===== 汇总 ===== */
  console.log(`\n===== v3.6 验证结果：${pass}/${pass + fail} 通过 =====`);
  if (fail) { console.log('失败项：'); console.log(`  共 ${fail} 项失败`); process.exitCode = 1; }
  console.log('CONSOLE-ERRORS:', JSON.stringify(p.consoleErrors));
});
