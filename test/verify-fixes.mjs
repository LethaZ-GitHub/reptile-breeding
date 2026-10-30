// test/verify-fixes.mjs —— 移动端视口（393x852）下的修复验证脚本
// 覆盖：底部导航顺序/首页居中、爬柜入口、横向溢出（记账表格）、物种筛选交互、控制台错误
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:3123/';
const PORT = 9334;
// 截图输出目录 = 本脚本所在目录（项目曾从 E: 迁到 G:，勿再写死绝对路径）
const TEST_DIR = path.dirname(process.argv[1] || __filename || '.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-verify-'));
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmpDir}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore', detached: true });

  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* retry */ }
  }
  if (!target) { console.error('FAIL: no target'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      consoleErrors.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: BASE });
  await sleep(3000);

  // ---- 注入种子数据：物种 + 个体 + 账单 + 配对 ----
  await evalJs(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('reptile-breeding', 4); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = db.transaction(['species', 'animal', 'bill', 'pairing'], 'readwrite');
    tx.objectStore('species').put({ id: 'sp-test-a', name: '测试物种甲', isCustom: true });
    tx.objectStore('species').put({ id: 'sp-test-b', name: '测试物种乙', isCustom: true });
    for (let i = 0; i < 6; i++) {
      tx.objectStore('animal').put({ id: 'an-test-' + i, name: '甲个体' + i, speciesId: 'sp-test-a', sex: i % 2 ? 'male' : 'female', status: 'normal', isArchived: false, tagIds: [], createdAt: '2026-10-19 10:00:00', updatedAt: '2026-10-19 10:00:00' });
      tx.objectStore('animal').put({ id: 'an-test-b' + i, name: '乙个体' + i, speciesId: 'sp-test-b', sex: 'male', status: 'normal', isArchived: false, tagIds: [], createdAt: '2026-10-19 10:00:00', updatedAt: '2026-10-19 10:00:00' });
      tx.objectStore('bill').put({ id: 'bill-seed-' + i, type: i % 3 === 0 ? 'income' : 'expense', category: '饲料', amount: 1234.5 + i, date: '2026-10-' + String(10 + i).padStart(2, '0'), relatedAnimalId: null, note: '某条比较长的备注信息用于撑宽表格第' + i + '条', auto: false, createdAt: '2026-10-19 10:00:00' });
    }
    tx.objectStore('pairing').put({ id: 'pr-seed-0', participants: ['an-test-0', 'an-test-b0'], pairDate: '2026-10-08', result: 'success', note: '种子配对', createdAt: '2026-10-19 10:00:00' });
    return new Promise((res) => { tx.oncomplete = () => res('ok'); });
  })()`, true);
  await send('Page.reload', { ignoreCache: true });
  await sleep(3000);

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // ---- 1. 底部导航顺序 + 首页居中 ----
  const nav = await evalJs(`(() => {
    const items = [...document.querySelectorAll('#bottomnav .bn-item')];
    return JSON.stringify(items.map((el) => ({ label: el.textContent.trim(), center: el.classList.contains('bn-center'), active: el.classList.contains('active') })));
  })()`);
  const navItems = JSON.parse(nav);
  check('底部导航顺序为 蛋管理/个体管理/首页/配对记录/更多（v2.7：记账与配对记录互换）',
    JSON.stringify(navItems.map((i) => i.label)) === JSON.stringify(['🥚蛋管理', '🦎个体管理', '🏠', '💞配对记录', '⋯更多']),
    navItems.map((i) => i.label).join(' | '));
  check('首页带居中样式类 bn-center', navItems[2] && navItems[2].center === true);
  check('首页默认高亮', navItems[2] && navItems[2].active === true);
  check('首页按钮只显示图标无文字', navItems[2] && navItems[2].label === '🏠');

  // ---- 2. 各页面横向溢出检查（含记账有数据场景）----
  const routes = ['home', 'eggs', 'animals', 'bills', 'more', 'cages', 'reports', 'backup', 'settings', 'genes', 'pairings', 'tags', 'species', 'predict', 'animal/an-test-0', 'egg-list-x'];
  for (const r of routes) {
    const hash = r === 'egg-list-x' ? '#/eggs' : '#/' + r;
    await evalJs(`location.hash = '${hash}'`);
    await sleep(700);
    const probe = await evalJs(`(() => {
      const de = document.documentElement;
      const nav = document.getElementById('bottomnav');
      const navRect = nav.getBoundingClientRect();
      return JSON.stringify({
        scrollW: de.scrollWidth, clientW: de.clientWidth, innerW: window.innerWidth,
        navBottom: navRect.bottom, navH: navRect.height, navDisplay: getComputedStyle(nav).display,
      });
    })()`);
    const p = JSON.parse(probe);
    const overflow = p.scrollW > p.clientW + 1;
    const navVisible = p.navDisplay === 'flex' && p.navBottom <= 852 + 1 && p.navH > 30;
    check(`页面 ${r} 无横向溢出`, !overflow, `scrollW=${p.scrollW} clientW=${p.clientW}`);
    check(`页面 ${r} 底部导航可见`, navVisible, `bottom=${p.navBottom} h=${p.navH}`);
  }

  // ---- 3. 记账页列表容器 ----
  // v2.9：记账页由横向表格改为卡片式行（手机端金额列曾落在滚动区外不可见），
  //        断言相应改为「卡片容器存在 + 手机端无横向溢出 + 金额可见」。
  await evalJs(`location.hash = '#/bills'`);
  await sleep(700);
  const billsInfo = await evalJs(`(() => {
    const list = document.querySelector('#bill-list .bill-list');
    const items = document.querySelectorAll('#bill-list .bill-item');
    const first = items[0];
    const amt = first ? first.querySelector('.bi-amt') : null;
    const p = document.documentElement;
    return {
      hasList: !!list,
      items: items.length,
      hasAmount: !!amt && (amt.textContent || '').trim().length > 0,
      amountText: amt ? (amt.textContent || '').trim() : '',
      overflow: p.scrollW > p.clientW + 1,
    };
  })()`);
  check('记账页使用卡片式列表容器', billsInfo.hasList === true, JSON.stringify(billsInfo));
  check('记账条目显示金额', billsInfo.hasAmount === true, billsInfo.amountText);
  check('记账页无横向溢出', billsInfo.overflow === false, `overflow=${billsInfo.overflow}`);

  // ---- 4. 物种筛选交互 ----
  await evalJs(`location.hash = '#/animals'`);
  await sleep(700);
  const before = await evalJs(`document.querySelectorAll('#animal-list .row').length`);
  const speciesSeg = await evalJs(`(() => {
    const items = [...document.querySelectorAll('#f-species .seg-item')];
    const target = items.find((el) => el.textContent.trim() === '测试物种甲');
    if (!target) return 'not-found';
    target.click();
    return 'clicked';
  })()`);
  await sleep(400);
  const after = await evalJs(`document.querySelectorAll('#animal-list .row').length`);
  const firstRow = await evalJs(`(document.querySelector('#animal-list .row .row-title')||{}).textContent || ''`);
  check('物种筛选项存在且可点击', speciesSeg === 'clicked', String(speciesSeg));
  check('点击物种「测试物种甲」后列表只显示该物种', before === 12 && after === 6, `筛选前=${before} 筛选后=${after}，首行=${firstRow.trim()}`);

  // ---- 5. 更多页包含爬柜入口，不含蛋管理/品系库 ----
  await evalJs(`location.hash = '#/more'`);
  await sleep(600);
  const moreHas = await evalJs(`[...document.querySelectorAll('.more-cell')].some((c) => c.textContent.includes('爬柜'))`);
  check('更多页包含「爬柜方案」入口', moreHas === true);
  const moreNoEgg = await evalJs(`[...document.querySelectorAll('.more-cell')].some((c) => c.textContent.includes('蛋管理'))`);
  check('更多页已移除「蛋管理」入口（底部导航已有）', moreNoEgg === false);
  const moreNoMorph = await evalJs(`[...document.querySelectorAll('.more-cell')].some((c) => c.textContent.includes('品系'))`);
  check('更多页已移除「品系库」入口', moreNoMorph === false);
  const moreHasPair = await evalJs(`[...document.querySelectorAll('.more-cell')].some((c) => c.textContent.includes('配对记录'))`);
  check('更多页已移除「配对记录」入口（v2.7 已迁入底部导航）', moreHasPair === false);
  const moreHasBill = await evalJs(`[...document.querySelectorAll('.more-cell')].some((c) => c.textContent.includes('记账报表'))`);
  check('更多页包含「记账报表」入口（v2.7 由底部菜单迁入）', moreHasBill === true);

  // ---- 5.5 配对记录页：列表渲染 + 个体详情配对区块 ----
  await evalJs(`location.hash = '#/pairings'`);
  await sleep(700);
  const pairRows = await evalJs(`document.querySelectorAll('#pair-list .row').length`);
  check('配对记录页渲染种子配对记录', pairRows >= 1, `rows=${pairRows}`);
  const pairText = await evalJs(`(document.querySelector('#pair-list')||{}).innerText || ''`);
  check('配对记录展示参与者与结果', pairText.includes('甲个体0') && pairText.includes('乙个体0') && pairText.includes('配对成功'), pairText.slice(0, 80));
  await evalJs(`location.hash = '#/animal/an-test-0'`);
  await sleep(700);
  const detailPair = await evalJs(`(document.querySelector('#view')||{}).innerText || ''`);
  check('个体详情页展示该个体配对记录', detailPair.includes('配对记录') && detailPair.includes('乙个体0'), '');

  // ---- 5.6 基因库功能按钮 ----
  await evalJs(`location.hash = '#/genes'`);
  await sleep(700);
  const geneBtns = await evalJs(`JSON.stringify(['btn-add','btn-export','btn-import','btn-reset'].map((id) => !!document.getElementById(id)))`);
  check('基因库含 新增/导出/导入/恢复出厂 按钮', JSON.stringify([true, true, true, true]) === geneBtns, geneBtns);

  // ---- 6. 返回键处理函数存在 ----
  const backFn = await evalJs(`typeof window.__rbBack === 'function' ? window.__rbBack() : 'missing'`);
  check('__rbBack 已定义且当前可返回（history>1）', backFn === 'handled', String(backFn));

  // ---- 7. 截图 ----
  await evalJs(`location.hash = '#/bills'`);
  await sleep(800);
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(TEST_DIR, 'verify-bills.png'), Buffer.from(shot1.data, 'base64'));
  await evalJs(`location.hash = '#/animals'`);
  await sleep(800);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(TEST_DIR, 'verify-animals.png'), Buffer.from(shot2.data, 'base64'));

  console.log('\n=== 控制台错误 ===');
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '(无)');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== 汇总: ${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) { failed.forEach((f) => console.log('失败: ' + f.name + ' — ' + f.detail)); }

  ws.close();
  try { process.kill(-edge.pid); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failed.length ? 2 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
