// tools/sync-web.mjs —— 把 Web 端静态资源同步到 www/（Capacitor webDir）
// 用法：node tools/sync-web.mjs（改完前端后、npx cap sync 前执行）
// 只同步应用运行所需文件；server.js / test / tools / 原生工程 / 依赖均不进入 APK。
// 注意：本机托管 Node 的 fs.cpSync 递归拷贝会直接崩溃（0xC0000409），故手写递归拷贝。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WWW = path.join(ROOT, 'www');

// 本机 Node 的 fs.rmSync(recursive) 偶发 0xC0000409 进程级崩溃：先试原生删除，
// 崩溃则无救（进程已死），抛异常时改走手写递归删除兜底。
function wipeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) wipeDir(p);
      else fs.unlinkSync(p);
    }
    fs.rmdirSync(dir);
  }
}
wipeDir(WWW);
fs.mkdirSync(WWW, { recursive: true });

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dst, name));
  } else {
    fs.copyFileSync(src, dst);
  }
}

const ITEMS = ['index.html', 'css', 'js', 'manifest.webmanifest', 'sw.js', 'icons'];
for (const it of ITEMS) copyRecursive(path.join(ROOT, it), path.join(WWW, it));

// v2.9：更新日志正文外置
//   源文件在项目根目录「更新日志.txt」（用户直接改这个文件即可）；
//   构建时复制为 www/release-notes.txt —— 用 ASCII 文件名，避免中文名在
//   WebView 的 fetch URL / APK assets 打包链路上出现编码问题。
const NOTES_SRC = path.join(ROOT, '更新日志.txt');
if (fs.existsSync(NOTES_SRC)) {
  fs.copyFileSync(NOTES_SRC, path.join(WWW, 'release-notes.txt'));
}

// v3.3：License 文件（Apache-2.0 + Commons Clause）
//   根目录 LICENSE 为唯一源，复制为 www/license.txt（ASCII 文件名，
//   「关于」页 fetch 后弹窗展示完整协议内容）。
const LICENSE_SRC = path.join(ROOT, 'LICENSE');
if (fs.existsSync(LICENSE_SRC)) {
  fs.copyFileSync(LICENSE_SRC, path.join(WWW, 'license.txt'));
}

// 给 index.html 的资源引用注入版本号 query，破坏 WebView 磁盘缓存：
// 覆盖安装 APK 后，即使 WebView 按 URL 命中了旧缓存，新 ?v= 也会强制重新拉取。
// （曾因 assets 未打包 + WebView 缓存导致“装了新包还是旧界面”的疑难问题。）
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version.replace(/[^\w.]/g, ''); }
  catch { return '0'; }
})();
const htmlPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/(href|src)="(css|js|icons)\/([^"?]+\.(?:css|js|png|svg|ico|webmanifest))"/g,
  (m, attr, dir, file) => `${attr}="${dir}/${file}?v=${VERSION}"`);
html = html.replace(/href="manifest\.webmanifest"/g, `href="manifest.webmanifest?v=${VERSION}"`);
fs.writeFileSync(htmlPath, html);

/* ---------- v2.9：给 ES module 内部的相对 import 注入版本号 ----------
   根因：index.html 只给顶层 css/js 加了 ?v=，但 js/*.js 内部的
   `import ... from './store.js'` 等 146 处相对导入**没有**版本号。
   Android WebView 按 URL 缓存模块，覆盖安装新 APK 后
   js/ui.js、js/pages/animal-form.js 等仍命中旧缓存 —— 表现为
   「手机端导出的基因预测图与电脑端样式不同步」「新建个体界面不是最新版」。
   修复：把 js/ 下所有相对导入重写为 './xxx.js?v=<version>'，
   强制 WebView 每次升级都重新拉取模块。 */
function rewriteImports(dir) {
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { n += rewriteImports(p); continue; }
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(p, 'utf8');
    // from './x.js' / from "../x.js" / import('./x.js')
    const out = src.replace(
      /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+?)(\2)/g,
      (m, kw, q, spec, qq) => {
        if (/[?#]/.test(spec)) return m;   // 已带 query/hash，跳过
        return `${kw}${q}${spec}?v=${VERSION}${qq}`;
      }
    );
    if (out !== src) { fs.writeFileSync(p, out); n++; }
  }
  return n;
}
const rewritten = rewriteImports(path.join(WWW, 'js'));
console.log(`module imports versioned: ${rewritten} files`);

// 版本号写入 js/version.js（保证设置/关于页显示与实际打包一致）
const verPath = path.join(WWW, 'js', 'version.js');
try {
  const vs = fs.readFileSync(verPath, 'utf8')
    .replace(/export const APP_VERSION = '[^']*';/, `export const APP_VERSION = '${VERSION}';`);
  fs.writeFileSync(verPath, vs);
} catch (e) { /* version.js 不存在则跳过 */ }

const count = (() => { let n = 0, bytes = 0; const walk = (d) => { for (const ent of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, ent.name); if (ent.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } }; walk(WWW); return [n, bytes]; })();
console.log(`web assets synced -> www/ (${count[0]} files, ${(count[1] / 1024).toFixed(0)} KB)`);
