// verify-v16.mjs —— 本轮验证：顶栏返回按钮 / 爬柜爬箱数自动创建 / 爬箱卡片去尺寸三列 / 全局图片灯箱 / 谱系放大 / 曲线图导出 PNG
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3219/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 顶栏返回按钮 ===== */
  await p.eval(`location.hash = '#/home'`, { awaitPromise: false });
  await wait(p, 700);
  const backHome = await p.eval(`document.getElementById('btn-back').hidden`);
  ok('一级页面（首页）不显示返回按钮', backHome === true, String(backHome));

  await p.eval(`location.hash = '#/animal/new'`, { awaitPromise: false });
  await wait(p, 900);
  const backSub = await p.eval(`(() => ({ hidden: document.getElementById('btn-back').hidden, hash: location.hash }))()`);
  ok('二级页面显示左上角返回按钮', backSub.hidden === false && backSub.hash === '#/animal/new', JSON.stringify(backSub));

  await p.eval(`document.getElementById('btn-back').click()`, { awaitPromise: false });
  await wait(p, 900);
  const afterBack = await p.eval(`location.hash`);
  ok('点击返回按钮回到上一级页面', afterBack === '#/home', afterBack);

  await p.eval(`location.hash = '#/more'`, { awaitPromise: false });
  await wait(p, 700);
  const backMore = await p.eval(`document.getElementById('btn-back').hidden`);
  ok('更多页（一级）不显示返回按钮', backMore === true, String(backMore));

  /* ===== B. 爬柜方案：可放爬箱数自动创建 ===== */
  const plan = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const p = await s.createPlan('V16爬柜${T}', { capacity: 2, lastCleanAt: u.todayStr() });
    return { id: p.id, name: p.name };
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/cages', 1200);
  const openBtnTxt = await p.eval(`(() => {
    const cards = [...document.querySelectorAll('#plan-list .card')];
    const c = cards.find((x) => x.textContent.includes('V16爬柜'));
    return c ? c.querySelector('[data-act="open"]').textContent : null;
  })()`);
  ok('「进入布局」按钮已改名「进入爬柜」', openBtnTxt === '进入爬柜', String(openBtnTxt));

  await p.eval(`(() => {
    const cards = [...document.querySelectorAll('#plan-list .card')];
    cards.find((x) => x.textContent.includes('V16爬柜${T}')).querySelector('[data-act="settings"]').click();
  })()`, { awaitPromise: false });
  await wait(p, 500);
  const capInput = await p.eval(`(() => { const i = document.getElementById('st-cap'); return i ? i.value : null; })()`);
  ok('爬柜设置弹窗含「可放爬箱数」输入框（回显当前值）', capInput === '2', String(capInput));

  await p.eval(`document.getElementById('st-cap').value = '5'`, { awaitPromise: false });
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '保存'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 1000);
  const capRes = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const p = s.listPlans().find((x) => x.name === 'V16爬柜${T}');
    return { capacity: p.capacity, cages: s.listCages(p.id).length };
  })()`, { awaitPromise: true });
  ok('数量增加时自动补齐爬箱（2 → 5）', capRes.capacity === 5 && capRes.cages === 5, JSON.stringify(capRes));

  /* ===== C. 爬箱卡片：去尺寸 / 三列 / 序号+名+编号 / 不限入住 ===== */
  await p.goto(BASE + '#/cage/' + plan.id, 1200);
  const gridInfo = await p.eval(`(() => {
    const grid = document.querySelector('.cage-grid');
    const cells = grid ? [...grid.querySelectorAll('.cage-cell')] : [];
    const cs = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    const first = cells[0] ? cells[0].textContent : '';
    return { cols: cs, count: cells.length, firstTxt: first.replace(/\\s+/g, ' ').slice(0, 60), hasCm: /cm|×|规格/.test(first) };
  })()`);
  ok('爬箱卡片一行三列布局', gridInfo.cols === 3, JSON.stringify(gridInfo));
  ok('卡片仅显示序号与入住信息（无尺寸参数）', gridInfo.count === 5 && !gridInfo.hasCm, JSON.stringify(gridInfo));

  const bindRes = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const p = s.listPlans().find((x) => x.name === 'V16爬柜${T}');
    const cage = s.listCages(p.id)[0];
    const animals = s.listAnimals({ status: 'active' }).slice(0, 3);
    for (const a of animals) await s.bindAnimalToCage(a.id, cage.id);
    return { n: s.animalsInCage(cage.id).length };
  })()`, { awaitPromise: true });
  ok('同一爬箱可入住多只个体（不限制数量）', bindRes.n >= 3, JSON.stringify(bindRes));

  await p.eval(`location.hash = '#/home'`, { awaitPromise: false });
  await wait(p, 500);
  await p.goto(BASE + '#/cage/' + plan.id, 1200);
  const cellTxt = await p.eval(`(() => {
    const cell = document.querySelector('.cage-cell');
    return cell ? cell.textContent.replace(/\\s+/g, ' ') : '';
  })()`);
  ok('卡片显示序号与入住个体名 / 编号', /爬箱 1/.test(cellTxt) && cellTxt.includes('测试'), cellTxt.slice(0, 90));

  // 添加爬箱弹窗（用测试种子方案：capacity 4 / 已有 2 箱，还能加）
  const seedPlanId = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const p = s.listPlans().find((x) => x.name.includes('爬柜'));
    return p ? p.id : '';
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/cage/' + seedPlanId, 1200);
  await p.eval(`document.getElementById('btn-add-cage').click()`, { awaitPromise: false });
  await wait(p, 450);
  const addModal = await p.eval(`(() => ({ hasSize: !!document.getElementById('cg-size'), hasZone: !!document.getElementById('cg-zone'), hasNote: !!document.getElementById('cg-note') }))()`);
  ok('添加爬箱弹窗已移除尺寸规格（保留分区与备注）', addModal.hasSize === false && addModal.hasZone && addModal.hasNote, JSON.stringify(addModal));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '取消'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 200);

  /* ===== D. 全局图片灯箱 ===== */
  const lb = await p.eval(`(async () => {
    const m = await import('./js/lightbox.js');
    // 1x1 透明 PNG
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    m.openImageViewer(src, '测试图片');
    const root = document.querySelector('.zoom-viewer');
    const img = root.querySelector('img');
    const r1 = { open: root.classList.contains('open'), srcOk: img && img.src.startsWith('data:image/png'), title: root.querySelector('.zv-title').textContent };
    // 全局委托：页面里的 img 点击后打开
    const probe = document.createElement('img');
    probe.src = src; probe.alt = '委托图片';
    document.getElementById('view').appendChild(probe);
    m.closeZoomViewer();
    probe.click();
    const r2 = { open: document.querySelector('.zoom-viewer').classList.contains('open'), title: document.querySelector('.zv-title').textContent };
    m.closeZoomViewer();
    probe.remove();
    // SVG 查看器
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 50');
    m.openSvgViewer(svg, '测试SVG');
    const r3 = { open: document.querySelector('.zoom-viewer').classList.contains('open'), hasSvg: !!document.querySelector('.zoom-viewer svg') };
    m.closeZoomViewer();
    return { r1, r2, r3 };
  })()`, { awaitPromise: true });
  ok('图片查看器可打开并显示图片与标题', lb.r1.open && lb.r1.srcOk && lb.r1.title === '测试图片', JSON.stringify(lb.r1));
  ok('全局点击委托：页面内图片点击即放大', lb.r2.open && lb.r2.title === '委托图片', JSON.stringify(lb.r2));
  ok('SVG 查看器可打开（谱系图复用）', lb.r3.open && lb.r3.hasSvg, JSON.stringify(lb.r3));

  /* ===== E. 谱系弹窗与放大（v2.6：名字行入口 + 弹窗 + 修复 SVG 无宽高塌缩） ===== */
  // 造一条有父母本的个体，进入详情页
  const pedAnimal = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const sp = s.listSpecies()[0];
    const mom = await s.createAnimal({ name: 'V16外婆${T}', speciesId: sp.id, sex: 'female' });
    const dad = await s.createAnimal({ name: 'V16外公${T}', speciesId: sp.id, sex: 'male' });
    const kid = await s.createAnimal({ name: 'V16谱系${T}', speciesId: sp.id, sex: 'female', motherId: mom.id, fatherId: dad.id });
    return kid.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/animal/' + pedAnimal, 1400);
  const pedBtn = await p.eval(`(() => ({ has: !!document.getElementById('btn-pedigree'), hasPedTab: [...document.querySelectorAll('#d-tabs .tab')].some((t) => t.textContent.includes('谱系')) }))()`);
  ok('谱系入口在名字行且无独立 Tab（v2.6）', pedBtn.has && !pedBtn.hasPedTab, JSON.stringify(pedBtn));
  await p.eval(`document.getElementById('btn-pedigree').click()`, { awaitPromise: false });
  await wait(p, 500);
  const pedModal = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return { open: !!m, hasSvg: !!m.querySelector('#pedm-svg'), zoom: !!m.querySelector('#pedm-zoom'), nodes: m.querySelectorAll('.ped-node').length };
  })()`);
  ok('谱系弹窗含三代树 SVG 与放大按钮', pedModal.open && pedModal.hasSvg && pedModal.zoom && pedModal.nodes >= 3, JSON.stringify(pedModal));
  await p.eval(`document.getElementById('pedm-zoom').click()`, { awaitPromise: false });
  await wait(p, 500);
  const pedZoom = await p.eval(`(() => {
    const s = document.querySelector('.zoom-viewer svg');
    return { open: document.querySelector('.zoom-viewer').classList.contains('open'), hasSvg: !!s, w: s ? Number(s.getAttribute('width')) : 0, nodes: document.querySelectorAll('.zoom-viewer .ped-node').length };
  })()`);
  ok('点击放大按钮在全屏查看器中打开族谱（节点齐全且 SVG 有实际宽高）',
    pedZoom.open && pedZoom.hasSvg && pedZoom.w > 100 && pedZoom.nodes >= 3, JSON.stringify(pedZoom));
  await p.eval(`(async () => { const m = await import('./js/lightbox.js'); m.closeZoomViewer(); })()`, { awaitPromise: false });
  await wait(p, 200);
  // 关闭族谱弹窗，避免残留 .modal 干扰后续断言
  await p.eval(`(() => { const m = [...document.querySelectorAll('.modal-mask')].find((x) => x.textContent.includes('族谱')); if (m) m.remove(); })()`, { awaitPromise: false });
  await wait(p, 150);

  /* ===== F. 曲线图导出 PNG（含降级链） ===== */
  const exp = await p.eval(`(async () => {
    const downloads = [];
    const blobs = [];
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { const u = origCreate(b); blobs.push({ url: u, blob: b }); return u; };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, href: this.href }); };
    const c = await import('./js/charts.js');
    const host = document.createElement('div');
    host.innerHTML = '<svg viewBox="0 0 680 210" xmlns="http://www.w3.org/2000/svg"><rect width="680" height="210" fill="#fff"/><text x="10" y="20">测试曲线</text></svg>';
    document.body.appendChild(host);
    c.svgToPng(host.querySelector('svg'), 'V16曲线.png', { scale: 2 });
    await new Promise((r) => setTimeout(r, 1500));
    host.remove();
    URL.createObjectURL = origCreate;
    HTMLAnchorElement.prototype.click = origClick;
    // Blob 对象不受 revokeObjectURL 影响；尺寸在页面内算好（CDP 返回值走 JSON，Uint8Array 会丢 length）
    const reads = [];
    for (const item of blobs) {
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      let w = 0, h = 0;
      if (bytes.length > 24) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        w = dv.getUint32(16); h = dv.getUint32(20);
      }
      reads.push({ url: item.url, w, h, len: bytes.length });
    }
    return { downloads, reads };
  })()`, { awaitPromise: true });
  const pngIdx = exp.downloads.findIndex((d) => /\.png$/.test(d.name));
  const pngRead = pngIdx >= 0 ? exp.reads.find((r) => r.url === exp.downloads[pngIdx].href) : null;
  ok('合法 SVG 导出为 PNG 文件（1360×420）', pngIdx >= 0 && pngRead && pngRead.w === 1360 && pngRead.h === 420 && pngRead.len > 1000, JSON.stringify({ name: exp.downloads[pngIdx] && exp.downloads[pngIdx].name, pngRead }));

  // 降级路径：stub 让 Image 加载必然失败且永不触发 onload → data URL 与 Blob URL 都失败 → 保存 .svg 兜底
  const fb = await p.eval(`(async () => {
    const downloads = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
    const OrigImage = window.Image;
    const Stub = class extends OrigImage {
      constructor() { super(); setTimeout(() => { if (this.onerror) this.onerror(new Error('stub-load-fail')); }, 0); }
    };
    // 屏蔽 onload（只允许 onerror 触发），模拟「SVG 图片完全加载不了」的老 WebView
    Object.defineProperty(Stub.prototype, 'onload', { set() { /* swallow */ }, get() { return null; }, configurable: true });
    window.Image = Stub;
    const c = await import('./js/charts.js');
    const host = document.createElement('div');
    host.innerHTML = '<svg viewBox="0 0 680 100" xmlns="http://www.w3.org/2000/svg"><rect width="680" height="100" fill="#fff"/></svg>';
    document.body.appendChild(host);
    c.svgToPng(host.querySelector('svg'), 'V16损坏.png', { scale: 1 });
    await new Promise((r) => setTimeout(r, 2500));
    host.remove();
    window.Image = OrigImage;
    HTMLAnchorElement.prototype.click = origClick;
    return downloads;
  })()`, { awaitPromise: true });
  const svgDl = fb.find((d) => /\.svg$/.test(d));
  ok('PNG 失败时降级保存 SVG 图片（保证手机端有图）', !!svgDl && !fb.some((d) => /\.png$/.test(d)), JSON.stringify(fb));

  /* ===== 汇总 ===== */
  const pass = R.filter((r) => r[1]).length;
  console.log('\\n========== 汇总：' + pass + '/' + R.length + ' ==========');
  const fails = R.filter((r) => !r[1]);
  if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  ❌ ' + f[0] + ' — ' + (f[2] || ''))); process.exitCode = 1; }
});
