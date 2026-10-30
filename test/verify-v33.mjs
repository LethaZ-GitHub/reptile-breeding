// verify-v33.mjs —— v3.3 八项功能专项验证
//   A. 首页「喂养记录」：选个体后弹出与个体页一致的喂食表单，提交后每个个体一条独立记录
//   B. 个体列表缩略图恢复点击放大（点缩略图开灯箱，点其它区域进详情）
//   C. 基因库新增名称检索框；预测结果「基因名称」可点击查看基因详情（猪鼻蛇）
//   D. 电脑端侧边导航补齐全部功能入口
//   E. 「更多」页关于卡片读取更新日志.txt 的「关于」段落 + License 超链接与弹窗
//   F. 版本更新说明弹窗（软件名 + 免费/捐助 + 更新内容），同一版本仅弹一次
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3238';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};
const T = Date.now().toString(36).slice(-5);

await withBrowser(async (p) => {
  await p.goto(BASE + '#/home', 1500);
  await seedFixture(p);

  /* ===== F-1. 版本更新弹窗：同一版本仅弹一次 =====
     注意：runModal 的 Promise 要等弹窗关闭才 resolve，若在同一个 await 里既等待
     Promise 又去点关闭按钮，会形成自锁死等（eval timeout）。
     因此拆成：①触发弹窗（不 await） ②读取 DOM + 点击关闭 ③await 结果。 */
  const F0 = await p.eval(`(async () => {
    const m = await import('./js/update-notice.js');
    const v = await import('./js/version.js');
    // 清掉 boot() 首启自动弹出的更新弹窗残留（避免干扰计数）
    document.querySelectorAll('.modal-mask').forEach((x) => x.remove());
    // 清除已读标记，模拟新版本首次启动
    try { localStorage.removeItem('rb-update-seen-version'); } catch (e) {}
    const before = m.hasSeenVersion(v.APP_VERSION);
    window.__rbUn = m.maybeShowUpdateNotice();   // 不 await，弹窗 Promise 挂到 window
    window.__rbVer = v.APP_VERSION;
    return { ver: v.APP_VERSION, before };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(F0));
  ok('清除已读标记后当前版本未被标记为已读', F0.before === false, JSON.stringify(F0));

  await sleep(600);
  const F1 = await p.eval(`(async () => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const mm = masks[masks.length - 1];
    const body = mm ? mm.textContent : '';
    const m = await import('./js/update-notice.js');
    const v = await import('./js/version.js');
    // 版本无关：取当前版本在更新日志中的条目，逐条核对是否都出现在弹窗里
    const sec = await m.findVersionNotes(v.APP_VERSION);
    const expect = sec ? sec.lines : [];
    const info = {
      maskCount: masks.length,
      title: mm ? (mm.querySelector('.m-title') || {}).textContent || '' : '',
      hasAppName: body.includes('养个爬'),
      hasFree: body.includes('本软件全功能免费'),
      hasUpdateHead: body.includes('本次更新内容'),
      hasItems: expect.length > 0 && expect.every((l) => body.includes(l)),
      expectCount: expect.length,
      ver: v.APP_VERSION,
      btn: mm ? [...mm.querySelectorAll('.m-foot .btn')].map(b => b.textContent).join(',') : '',
    };
    const b = mm ? [...mm.querySelectorAll('.m-foot .btn')][0] : null;
    if (b) b.click();
    return info;
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(F1));
  ok('版本更新弹窗已弹出', F1.maskCount >= 1, JSON.stringify(F1));
  ok('更新弹窗标题为软件名「养个爬」', F1.title.includes('养个爬'), F1.title);
  ok('更新弹窗含「本软件全功能免费，若支持可捐助」', F1.hasFree === true, '');
  ok('更新弹窗含「本次更新内容」区块', F1.hasUpdateHead === true, '');
  ok('更新弹窗列出当前版本的全部更新条目', F1.hasItems === true, JSON.stringify(F1));
  ok('更新弹窗有「知道了」按钮', F1.btn.includes('知道了'), F1.btn);

  await sleep(400);
  const F1b = await p.eval(`(async () => {
    const m = await import('./js/update-notice.js');
    const v = await import('./js/version.js');
    const r1 = await window.__rbUn;
    return { r1, seen: m.hasSeenVersion(v.APP_VERSION), maskCount: document.querySelectorAll('.modal-mask').length };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(F1b));
  ok('更新弹窗关闭后标记为已读', F1b.seen === true, JSON.stringify(F1b));

  const F2 = await p.eval(`(async () => {
    const m = await import('./js/update-notice.js');
    const r2 = await m.maybeShowUpdateNotice();
    const masks = [...document.querySelectorAll('.modal-mask')];
    return { r2, maskCount: masks.length };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(F2));
  ok('同一版本第二次不再弹出更新弹窗', F2.r2 === false && F2.maskCount === 0, JSON.stringify(F2));

  /* ===== A. 首页批量喂食弹窗 ===== */
  await p.goto(BASE + '#/home', 1200);
  await p.eval(`document.getElementById('btn-feeding').click()`, { awaitPromise: false });
  await sleep(500);
  await p.eval(`document.getElementById('ff-feed').click()`, { awaitPromise: false });
  await sleep(600);
  // 勾选前 2 只
  await p.eval(`(() => {
    const cbs = [...document.querySelectorAll('#ff-list .pick-row input[type=checkbox]')];
    cbs[0].click(); cbs[1].click();
  })()`, { awaitPromise: false });
  await sleep(300);
  // 点「确定记录」
  await p.eval(`(() => { [...document.querySelectorAll('.modal-mask .m-foot .btn')].find(b=>b.textContent==='确定记录').click(); })()`, { awaitPromise: false });
  await sleep(800);
  const A1 = await p.eval(`(() => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const m = masks[masks.length - 1];
    return {
      maskCount: masks.length,
      title: m ? (m.querySelector('.m-title')||{}).textContent||'' : '',
      hasPick: !!m.querySelector('#lg-food-pick'),
      hasQty: !!m.querySelector('#lg-qty'),
      hasAte: !!m.querySelector('#lg-ate'),
      hasNote: !!m.querySelector('#lg-note'),
      noTextInput: !m.querySelector('#lg-food'),
      pickOpts: m && m.querySelector('#lg-food-pick') ? [...m.querySelector('#lg-food-pick').options].map(o=>o.textContent) : [],
    };
  })()`);
  console.log('  ' + JSON.stringify(A1));
  ok('选个体后弹出喂食表单（复用个体页表单）', A1.maskCount >= 1 && A1.hasPick === true, JSON.stringify(A1));
  ok('喂食表单含食物下拉/数量/吃食情况/备注', A1.hasPick && A1.hasQty && A1.hasAte && A1.hasNote, JSON.stringify(A1));
  ok('喂食表单无冗余食物文本框', A1.noTextInput === true, '');

  // 选食物 + 填数量 → 保存
  const beforeCount = await p.eval(`(async () => { const s = await import('./js/store.js'); return s.S.animal_log.filter(l=>l.logType==='feed').length; })()`, { awaitPromise: true });
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const sel = m.querySelector('#lg-food-pick');
    const opts = [...sel.options];
    const target = opts.find(o => o.value && o.value.indexOf('白蟋蟀') >= 0) || opts.find(o => o.value);
    if (target) { sel.value = target.value; sel.dispatchEvent(new Event('change', {bubbles:true})); }
    const q = m.querySelector('#lg-qty'); if (q) q.value = '7 只';
    const n = m.querySelector('#lg-note'); if (n) n.value = 'V33批量';
    [...m.querySelectorAll('.m-foot .btn')].find(b=>b.textContent==='保存').click();
  })()`, { awaitPromise: false });
  await sleep(1200);
  const A2 = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const feeds = s.S.animal_log.filter(l => l.logType === 'feed');
    const mine = feeds.filter(l => (l.data && l.data.note) === 'V33批量');
    const ids = [...new Set(mine.map(l => l.animalId))];
    return { total: feeds.length, mine: mine.length, distinctAnimals: ids.length, sample: mine[0] ? mine[0].data : null };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(A2));
  ok('保存后为每个选中个体各生成一条喂食记录', A2.mine === 2 && A2.distinctAnimals === 2, JSON.stringify(A2));
  ok('喂食记录带上表单填写的信息', A2.sample && A2.sample.food && A2.sample.qty === '7 只', JSON.stringify(A2.sample));

  /* ===== B. 个体列表缩略图点击放大 ===== */
  await p.goto(BASE + '#/animals', 1500);
  await sleep(500);
  // 夹具默认没有照片，先给第一只个体补一张占位图，才能渲染出 <img> 缩略图
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.listAnimals().find((x) => (x.name || '').includes('守宫-公子'));
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    if (a) { await s.addPhoto(a.id, { full: png, thumb: png }); await s.reload(); }
  })()`, { awaitPromise: true });
  // 坑：goto 同 hash 不触发重渲染，须先跳离再跳回
  await p.goto(BASE + '#/home', 600);
  await p.goto(BASE + '#/animals', 1500);
  await sleep(600);
  const B1 = await p.eval(`(() => {
    const t = document.querySelector('#animal-list .animal-thumb');
    const img = document.querySelector('#animal-list .animal-thumb img');
    return {
      hasThumb: !!t,
      hasImg: !!img,
      noZoom: !!(t && t.classList.contains('no-zoom')),
      imgNoZoom: !!(img && img.closest('.no-zoom')),
    };
  })()`);
  console.log('  ' + JSON.stringify(B1));
  ok('个体列表缩略图存在且可渲染图片', B1.hasThumb === true && B1.hasImg === true, JSON.stringify(B1));
  ok('个体列表缩略图不再标记 no-zoom（可放大）', B1.noZoom === false && B1.imgNoZoom === false, JSON.stringify(B1));

  // 点击缩略图 → 打开灯箱，且不跳转详情
  await p.eval(`(() => { const i = document.querySelector('#animal-list .animal-thumb img'); if (i) i.click(); })()`, { awaitPromise: false });
  await sleep(600);
  const B2 = await p.eval(`(() => ({
    zoomOpen: !!document.querySelector('.zoom-viewer.open'),
    hash: location.hash,
  }))()`);
  console.log('  ' + JSON.stringify(B2));
  ok('点击缩略图打开图片全屏查看器', B2.zoomOpen === true, JSON.stringify(B2));
  ok('点击缩略图不跳转个体详情', !/#\/animal\//.test(B2.hash), B2.hash);

  // 关闭灯箱后，点行体（名称）→ 进详情
  await p.eval(`(() => { const z = document.querySelector('.zoom-viewer.open'); if (z) { const c = z.querySelector('.zv-close'); if (c) c.click(); } })()`, { awaitPromise: false });
  await sleep(400);
  await p.eval(`(() => { const n = document.querySelector('#animal-list .row .rt-name'); if (n) n.click(); })()`, { awaitPromise: false });
  await sleep(700);
  const B3 = await p.eval(`(() => ({ hash: location.hash }))()`);
  console.log('  ' + JSON.stringify(B3));
  ok('点击行体（名称）仍进入个体详情', /#\/animal\//.test(B3.hash), B3.hash);

  /* ===== C. 基因库检索 + 猪鼻蛇基因名称可点击 ===== */
  await p.goto(BASE + '#/genes', 1500);
  await sleep(400);
  const C1 = await p.eval(`(() => ({
    hasSearch: !!document.getElementById('f-q'),
    rows: document.querySelectorAll('#gene-tbl tbody tr').length,
  }))()`);
  console.log('  ' + JSON.stringify(C1));
  ok('基因库页有名称检索框', C1.hasSearch === true, JSON.stringify(C1));

  // 筛猪鼻蛇 + 搜「白化」
  await p.eval(`(() => { const it=[...document.querySelectorAll('#f-species .seg-item')].find(x=>x.textContent.includes('猪鼻蛇')); if(it) it.click(); })()`, { awaitPromise: false });
  await sleep(400);
  const C2 = await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#gene-tbl tbody tr')].map(t => t.children[0].textContent.trim());
    const q = document.getElementById('f-q');
    q.value = '白化'; q.dispatchEvent(new Event('input', {bubbles:true}));
    return { all: rows.length, allNames: rows };
  })()`);
  await sleep(300);
  const C3 = await p.eval(`(() => [...document.querySelectorAll('#gene-tbl tbody tr')].map(t => t.children[0].textContent.trim()))()`);
  console.log('  ' + JSON.stringify(C3));
  // 命中规则：名称含「白化」，或复合基因的任一组分含「白化」（如「太阳爆炸」= 紫貂+白化）
  ok('基因库按名称检索命中（猪鼻蛇「白化」）', C3.length >= 3 && C3.includes('白化') && C3.includes('白化康达') && C3.includes('粉红蜡笔白化'), JSON.stringify(C3));
  ok('复合基因按组分检索命中（太阳爆炸=紫貂+白化）', C3.includes('太阳爆炸'), JSON.stringify(C3));

  // 按英文名检索
  await p.eval(`(() => { const q=document.getElementById('f-q'); q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); q.value='anaconda'; q.dispatchEvent(new Event('input',{bubbles:true})); })()`, { awaitPromise: false });
  await sleep(300);
  const C4 = await p.eval(`(() => [...document.querySelectorAll('#gene-tbl tbody tr')].map(t => t.children[0].textContent.trim()))()`);
  console.log('  ' + JSON.stringify(C4));
  ok('基因库按英文名检索命中（anaconda → 白化康达）', C4.length === 1 && C4[0] === '白化康达', JSON.stringify(C4));

  // 预测结果基因名称可点击
  await p.goto(BASE + '#/predict', 1500);
  await sleep(500);
  await p.eval(`(() => { const s=document.getElementById('f-species'); const o=[...s.options].find(x=>x.textContent.includes('猪鼻蛇')); s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); })()`, { awaitPromise: false });
  await sleep(500);
  await p.eval(`(() => {
    const set=(side,val)=>{const s=document.querySelector('#'+side+'-box .g-sel'); const o=[...s.options].find(x=>x.textContent.replace(/（.*$/,'')===val); if(o){s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('male','白化康达'); set('female','白化康达');
    document.getElementById('btn-run').click();
  })()`, { awaitPromise: false });
  await sleep(900);
  const C5 = await p.eval(`(() => {
    const m=[...document.querySelectorAll('.modal-mask')].pop();
    return {
      links: m ? m.querySelectorAll('.gp-name-link').length : 0,
      linkNames: m ? [...m.querySelectorAll('.gp-name-link')].map(a=>a.dataset.gpName) : [],
      rows: m ? [...m.querySelectorAll('.gp-table tbody tr')].map(t=>[...t.children].map(c=>c.textContent.trim()).join(' | ')) : [],
    };
  })()`);
  console.log('  ' + JSON.stringify(C5));
  ok('猪鼻蛇预测结果「白化康达」正确匹配复合基因名', C5.rows.some(r => r.includes('白化康达')), JSON.stringify(C5.rows));
  ok('预测结果基因名称渲染为可点击链接', C5.links >= 1, JSON.stringify(C5.linkNames));

  // 点击链接 → 弹出基因详情
  await p.eval(`(() => { const a=document.querySelector('.modal-mask .gp-name-link'); if(a) a.click(); })()`, { awaitPromise: false });
  await sleep(700);
  const C6 = await p.eval(`(() => {
    const masks=[...document.querySelectorAll('.modal-mask')];
    const m=masks[masks.length-1];
    return { count: masks.length, title: m?(m.querySelector('.m-title')||{}).textContent||'':'', body: m?m.textContent.slice(0,200):'' };
  })()`);
  console.log('  ' + JSON.stringify(C6));
  ok('点击基因名称弹出该基因的详情', C6.count >= 2 && C6.title.includes('基因详情'), JSON.stringify(C6));
  ok('基因详情显示英文名 Albino Anaconda', C6.body.includes('Albino Anaconda'), C6.body.slice(0, 120));

  /* ===== D. 电脑端导航入口齐全 ===== */
  await p.setViewport(1440, 900, false);
  await p.goto(BASE + '#/home', 1200);
  await sleep(600);
  const D1 = await p.eval(`(() => {
    const items = [...document.querySelectorAll('#sidebar .sb-item')].map(x => ({ label: x.textContent.replace(/\\d+$/,'').trim(), route: x.dataset.route }));
    return { count: items.length, items, routes: items.map(i=>i.route) };
  })()`);
  console.log('  ' + JSON.stringify(D1.items.map(i=>i.label).join(' / ')));
  const need = ['#/growth', '#/logs', '#/todos', '#/more', '#/backup', '#/share', '#/settings', '#/animals', '#/eggs', '#/cages', '#/predict', '#/genes', '#/species', '#/tags', '#/pairings', '#/bills', '#/home'];
  const missing = need.filter(r => !D1.routes.includes(r));
  ok('电脑端侧边导航包含全部功能入口', missing.length === 0, '缺失: ' + missing.join(','));
  // v3.4：月度报表已集成进「记账报表」，导航不再单独设「月度报表」入口（路由本身仍保留）
  ok('电脑端侧边导航不再含已下线的「月度报表」独立入口', !D1.routes.includes('#/reports'), '仍存在: #/reports');

  /* ===== E. 关于卡片读取更新日志 + License ===== */
  await p.goto(BASE + '#/more', 1500);
  await sleep(600);
  const E1 = await p.eval(`(() => ({
    about: (document.querySelector('.about-body')||{}).textContent||'',
    licLink: !!document.querySelector('#about-license-btn'),
    inlineLic: !!document.querySelector('#about-license'),
  }))()`);
  console.log('  ' + JSON.stringify(E1));
  ok('关于卡片正文来自更新日志.txt 的「关于」段落', E1.about.includes('本机数据库'), E1.about.slice(0, 80));
  ok('关于卡片含 License 超链接', E1.licLink === true, JSON.stringify(E1));

  await p.eval(`(() => { const a=document.getElementById('about-license-btn'); if(a) a.click(); })()`, { awaitPromise: false });
  await sleep(800);
  const E2 = await p.eval(`(() => {
    const masks=[...document.querySelectorAll('.modal-mask')];
    const m=masks[masks.length-1];
    const pre = m ? m.querySelector('.license-text') : null;
    return {
      count: masks.length,
      title: m?(m.querySelector('.m-title')||{}).textContent||'':'',
      hasPre: !!pre,
      len: pre ? pre.textContent.length : 0,
      hasApache: pre ? pre.textContent.includes('Apache License') : false,
      hasCommons: pre ? pre.textContent.includes('The Commons Clause') : false,
    };
  })()`);
  console.log('  ' + JSON.stringify(E2));
  ok('点击 License 弹出完整协议内容', E2.count >= 1 && E2.hasPre === true, JSON.stringify(E2));
  ok('License 内容含 Apache License 全文', E2.hasApache === true && E2.len > 5000, String(E2.len));
  ok('License 内容含 The Commons Clause 条款', E2.hasCommons === true, '');
});

console.log('\n汇总: ' + pass + ' 通过 / ' + (pass + fail) + ' 总计');
if (fail) { console.log('❌ 有 ' + fail + ' 项失败'); process.exit(1); }
else console.log('✅ 全部通过');
process.exit(0);
