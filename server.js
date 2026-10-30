// server.js —— 零依赖静态服务器（仅用于本地运行 Web 端；App 端由 Capacitor 打包，无需此服务）
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const argPort = process.argv.find((a) => a.startsWith('--port='));
const PORT = argPort ? +argPort.slice(7) : (process.env.PORT ? +process.env.PORT : 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // v2.9：更新日志别名 —— 源文件是中文名「更新日志.txt」（用户直接改它），
  //       但 Web 端 fetch 用 ASCII 名 release-notes.txt（避免 URL / assets 编码问题）。
  if (urlPath === '/release-notes.txt') urlPath = '/更新日志.txt';
  // v3.3：License 别名（根目录 LICENSE → /license.txt）
  if (urlPath === '/license.txt') urlPath = '/LICENSE';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // hash 路由兜底：非文件请求回退到 index.html
      if (!path.extname(urlPath)) {
        fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); res.end('Not Found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
          res.end(html);
        });
        return;
      }
      res.writeHead(404); res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('==================================================');
  console.log('  养个爬 · 本地服务已启动');
  console.log('  浏览器访问: http://localhost:' + PORT);
  console.log('  数据存储在浏览器本地 IndexedDB，不上传任何服务器');
  console.log('  按 Ctrl+C 停止服务');
  console.log('==================================================');
  openBrowser();
});

/* 启动后自动打开默认浏览器（--no-open 或 RB_NO_OPEN=1 可关闭） */
function openBrowser() {
  if (process.argv.includes('--no-open') || process.env.RB_NO_OPEN === '1') {
    console.log('  （已跳过自动打开浏览器）');
    return;
  }
  const url = 'http://localhost:' + PORT;
  let cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log('  自动打开浏览器失败，请手动访问上面的地址'));
    child.unref();
    console.log('  正在为您打开默认浏览器...');
  } catch (e) {
    console.log('  自动打开浏览器失败，请手动访问上面的地址');
  }
}
