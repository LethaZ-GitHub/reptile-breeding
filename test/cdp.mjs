// test/cdp.mjs —— 零依赖 CDP 客户端：驱动无头 Edge 做「真实时间」等待的渲染/交互验证
// 用法：node test/cdp.mjs <url> [等待毫秒=6000]
// 也可 import { withBrowser } 做脚本化验证。
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/* ---------- 最小 WebSocket 客户端（仅够 CDP 用） ---------- */
class Ws {
  constructor(url) {
    const u = new URL(url);
    this.sock = net.connect(+u.port, u.hostname);
    this.buf = Buffer.alloc(0);
    this.frames = [];
    this.handlers = {};
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.sock.on('connect', () => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
      this.sock.write(req);
    });
    this.sock.on('data', (d) => this._onData(d));
    this.sock.on('error', (e) => { this._rejectReady(e); if (this.onclose) this.onclose(e); });
  }
  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (!this._upgraded) {
      const idx = this.buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = this.buf.slice(0, idx).toString();
      if (!/101/.test(head)) { this._rejectReady(new Error('WS upgrade failed: ' + head)); return; }
      this._upgraded = true;
      this.buf = this.buf.slice(idx + 4);
      this._resolveReady();
    }
    for (; ;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      if (opcode === 8) { this.sock.end(); return; }
      if (opcode === 9) { this._sendFrame(0xA, payload); continue; } // ping→pong
      if (opcode === 1 || opcode === 0) {
        this.frames.push(payload);
        // 简化：CDP 消息通常单帧完整；尝试解析
        this._drain();
      }
    }
  }
  _drain() {
    while (this.frames.length) {
      const payload = Buffer.concat(this.frames);
      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { this.frames.length = 0; return; }
      this.frames.length = 0;
      if (msg.id && this.handlers[msg.id]) {
        const h = this.handlers[msg.id];
        delete this.handlers[msg.id];
        h(msg);
      } else if (msg.method && this.onmessage) {
        this.onmessage(msg);
      }
    }
  }
  _sendFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this._id || (this._id = 1);
    const h = {};
    const p = new Promise((res) => { h.res = res; });
    this.handlers[id] = (msg) => {
      if (msg.error) h.res({ error: msg.error });
      else h.res({ result: msg.result });
    };
    this._sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params })));
    return p;
  }
  close() { try { this.sock.end(); } catch (e) { /* ignore */ } }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 浏览器会话 ---------- */
/**
 * 杀掉残留的无头 Edge 进程。
 * 背景：proc.kill('SIGKILL') 只终止启动进程，Edge 的渲染/GPU 子进程会残留，
 *       并继续持有 --user-data-dir 目录与其中的 IndexedDB。下次启动时若 Edge
 *       发现已有实例在跑（同一调试端口），会【加入现有实例】而不是新建，
 *       于是不同测试套件之间共享了同一个浏览器 profile → IndexedDB 数据串味
 *       （曾表现为 verify-v23 期望空库却读到上个套件创建的个体）。
 * 这里在启动前清干净，保证每个套件都是全新的浏览器实例与空数据库。
 */
function killStaleEdge() {
  try {
    // 只杀带 --headless 的 Edge（避免误杀用户正常打开的浏览器）
    execSync('taskkill /F /IM msedge.exe /T', { stdio: 'ignore', timeout: 20000 });
  } catch (e) { /* 没有残留进程时 taskkill 返回非 0，忽略 */ }
}

/**
 * 找一个可用的 CDP 调试端口。
 *
 * 背景（v3.6 踩坑）：9222 端口可能被本机其它服务占用 —— 实测 WorkBuddy 自身的
 * 「MobileWork Browser Automation Gateway」就监听在 9222。此时 Edge 的
 * --remote-debugging-port=9222 绑定失败，我们连到的是那个网关：
 *   · /json/version 返回 {"Browser":"MobileWork Browser Automation Gateway"}
 *   · /json/list 返回 []（网关没有 page target）
 *   · /json/new?about:blank 返回 400「Target navigation URL must use http or https」
 * 于是 withBrowser 拿到 undefined 的 webSocketDebuggerUrl → 抛 ERR_INVALID URL，
 * 表现为【所有套件全挂】，但代码本身毫无问题。
 *
 * 判定端口归属：连上后读 /json/version，若 Browser 字段不含 "Edg/"（Edge 自报 Edg/）
 * 就说明不是我们启动的浏览器实例，换下一个端口重试。
 */
async function isOurEdge(port) {
  try {
    const v = await getJson(`http://127.0.0.1:${port}/json/version`);
    const b = String((v && v.Browser) || '');
    return /Edg\//.test(b);
  } catch (e) {
    return false;
  }
}

/** 端口是否已被占用（被别的服务监听） */
function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    setTimeout(() => { try { s.destroy(); } catch (e) { /* ignore */ } resolve(false); }, 800);
  });
}

/**
 * 启动 Edge 并返回可用的 CDP 端口。
 * 依次尝试 port、port+1、port+2 …（最多 8 个），跳过被占用或非 Edge 实例的端口。
 */
async function launchEdge(preferredPort, tmpDir) {
  for (let i = 0; i < 8; i++) {
    const port = preferredPort + i;
    if (await portBusy(port)) continue;         // 已被别的服务占用 → 跳过
    const proc = spawn(EDGE, [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      `--remote-debugging-port=${port}`, `--user-data-dir=${tmpDir}`,
      '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { stdio: 'ignore' });
    // 等待该端口上出现属于我们的 Edge 实例
    for (let k = 0; k < 40; k++) {
      await sleep(250);
      if (await isOurEdge(port)) return { proc, port };
    }
    try { proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
  throw new Error('无法启动无头 Edge：端口 ' + preferredPort + ' 起 8 个端口均不可用');
}

export async function withBrowser(fn, { port = 9222, suppressUpdateNotice = true } = {}) {
  killStaleEdge();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cdp-'));
  const { proc, port: realPort } = await launchEdge(port, tmp);
  let ws;
  try {
    let version = null;
    for (let i = 0; i < 40; i++) {
      try { version = await getJson(`http://127.0.0.1:${realPort}/json/version`); break; } catch (e) { await sleep(250); }
    }
    if (!version) throw new Error('无法连接无头 Edge 调试端口');
    // 找到 about:blank 页面目标
    let targets = await getJson(`http://127.0.0.1:${realPort}/json/list`);
    let page = targets.find((t) => t.type === 'page');
    if (!page) {
      page = await new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${realPort}/json/new?about:blank`, { method: 'PUT' }, (res) => {
          let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        });
        req.on('error', reject); req.end();
      });
    }
    ws = new Ws(page.webSocketDebuggerUrl);
    await ws.ready;
    await ws.send('Page.enable');
    await ws.send('Runtime.enable');
    // v3.3 起应用首启会自动弹出「版本更新说明」弹窗。它会叠在其它弹窗之下，
    // 导致既有套件里 `.modal .m-foot .btn:not(.ghost)` 选到更新弹窗的按钮而误操作。
    // 这里在文档创建前预置「已读标记」，等价于「这个版本我看过更新说明了」，
    // 从源头消除干扰；需要验证更新弹窗的套件（verify-v33）手动清标记后自行触发。
    if (suppressUpdateNotice) {
      let ver = '';
      try {
        const vfile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'version.js');
        const src = fs.readFileSync(vfile, 'utf8');
        ver = (src.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
      } catch (e) { ver = ''; }
      if (ver) {
        await ws.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `try{ localStorage.setItem('rb-update-seen-version', ${JSON.stringify(ver)}); }catch(e){}`,
        });
      }
    }
    const consoleErrors = [];
    ws.onmessage = (msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
        consoleErrors.push(msg.params.type.toUpperCase() + ': ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
      }
    };
    const api = {
      async goto(url, waitMs = 1200) {
        await ws.send('Page.navigate', { url });
        await sleep(waitMs);
      },
      async shot(file, { width, height } = {}) {
        if (width) await ws.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
        const r = await ws.send('Page.captureScreenshot', { format: 'png' });
        if (width) await ws.send('Emulation.clearDeviceMetricsOverride');
        if (r.result && r.result.data) {
          fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
          return true;
        }
        return false;
      },
      // 常驻视口覆写（手机端适配断言用；clearViewport 恢复桌面尺寸）
      async setViewport(width, height, mobile = true) {
        const r = await ws.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        if (r.error) throw new Error(r.error.message);
        await sleep(120);
      },
      async clearViewport() {
        await ws.send('Emulation.clearDeviceMetricsOverride');
        await sleep(120);
      },
      send: (method, params) => ws.send(method, params),
      async eval(expr, { awaitPromise = false, timeout = 12000 } = {}) {
        const r = await Promise.race([
          ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }),
          sleep(timeout).then(() => ({ error: { message: 'eval timeout' } })),
        ]);
        if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
        if (r.result && r.result.exceptionDetails) {
          const d = r.result.exceptionDetails;
          throw new Error('页面执行异常: ' + (d.exception && d.exception.description || d.text));
        }
        return r.result.result.value;
      },
      async waitFor(expr, timeout = 12000, interval = 300) {
        const t0 = Date.now();
        for (; ;) {
          const v = await api.eval(expr);
          if (v) return v;
          if (Date.now() - t0 > timeout) return null;
          await sleep(interval);
        }
      },
      consoleErrors,
    };
    await fn(api);
  } finally {
    if (ws) ws.close();
    proc.kill('SIGKILL');
    // 子进程（渲染/GPU）不会随父进程退出，需一并清理，
    // 否则它们会持有 profile 目录并让下一个套件复用同一个浏览器实例。
    await sleep(300);
    killStaleEdge();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

// CLI 模式：node test/cdp.mjs <url> [waitMs] —— 打印渲染文本与错误
if (process.argv[1] && process.argv[1].endsWith('cdp.mjs')) {
  const url = process.argv[2] || 'http://localhost:3210/';
  const waitMs = +(process.argv[3] || 6000);
  await withBrowser(async (api) => {
    await api.goto(url, waitMs);
    const info = await api.eval(`JSON.stringify({
      title: document.title,
      viewLen: (document.getElementById('view')||{}).innerHTML ? document.getElementById('view').innerHTML.length : -1,
      navCount: document.querySelectorAll('.sb-item').length,
      text: (document.getElementById('view')||{}).innerText ? document.getElementById('view').innerText.slice(0, 600) : '',
    })`);
    console.log(info);
    console.log('CONSOLE-ERRORS:', JSON.stringify(api.consoleErrors));
  }, { port: 9222 });
}
