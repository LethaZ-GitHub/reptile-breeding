// verify-growth.mjs —— 本轮新功能验证：改名 / 删入口 / 成长记录 / 喂养记录 / 饲养日志 / 孵化预填
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3245/';
const R = [];
const ok = (n, c, d) => R.push([n, c, d]);

const api = await withBrowser(async (p) => {
  // 灌入测试数据（提供个体/蛋/日志）——v2.3 起产品侧删除灌入功能，改测试侧夹具
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  // 1. 改名
  await p.goto(BASE, 1500);
  const brand = await p.eval(`document.querySelector('.tb-name').textContent + '|' + document.title`);
  ok('顶栏与标题改为「养个爬」', brand.startsWith('养个爬|') && brand.endsWith('养个爬') && !brand.includes('爬宠繁育'), brand);
  await p.goto(BASE + '#/more', 900);
  const moreTxt = await p.eval(`document.getElementById('view').textContent`);
  // v3.5：关于卡片标题与正文均按「更新日志.txt」的「关于」段落渲染
  ok('更多页关于卡片标题取自更新日志「关于 · 养个爬」', moreTxt.includes('关于 · 养个爬'), moreTxt.slice(0, 120));
  ok('更多页关于卡片正文取自更新日志（本机数据库 / 禁止售卖）',
    moreTxt.includes('本机数据库') && moreTxt.includes('禁止售卖'), moreTxt.slice(0, 200));

  // 2. 更多页入口：删三个、加两个
  const moreLinks = await p.eval(`[...document.querySelectorAll('.more-cell')].map((c) => c.textContent.trim())`);
  ok('更多页删除 个体归档/蛋归档/报表', !moreLinks.some((t) => ['个体归档', '蛋归档', '报表'].includes(t)), moreLinks.join(','));
  ok('更多页新增 成长记录/饲养日志', moreLinks.some((t) => t.includes('成长记录')) && moreLinks.some((t) => t.includes('饲养日志')), moreLinks.join(','));
  ok('更多页含「记账报表」（v2.7 迁入）、不含「配对记录」（已迁入底部导航）',
    moreLinks.some((t) => t.includes('记账报表')) && !moreLinks.some((t) => t.includes('配对记录')), moreLinks.join(','));

  // 3. 设置页：无安装到手机、有测试数据
  await p.goto(BASE + '#/settings', 900);
  const setTxt = await p.eval(`document.getElementById('view').textContent`);
  ok('设置页删除「安装到手机」', !setTxt.includes('安装到手机'), '');
  ok('设置页删除「测试数据」功能', !setTxt.includes('测试数据'), '');

  // 4. 成长记录页
  await p.goto(BASE + '#/growth', 1000);
  // 轮询等网格渲染（goto 只固定 sleep，慢加载下页面可能未就绪，固定等待会踩竞态）
  await p.eval(`new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      if (document.querySelector('.growth-cell')) return res();
      if (Date.now() - t0 > 10000) return rej(new Error('成长记录网格未渲染'));
      setTimeout(poll, 100);
    })();
  })`, { awaitPromise: true });
  const g1 = await p.eval(`({
    plan: !!document.getElementById('g-plan'),
    species: !!document.getElementById('g-species'),
    cells: document.querySelectorAll('.growth-cell').length,
  })`);
  ok('成长记录页：筛选下拉 + 个体头像网格', g1.plan && g1.species && g1.cells > 0, JSON.stringify(g1));
  // v3.1 起网格分页（每页 4 个），且夹具 createdAt 仅毫秒精度 → 首个格子归属不稳定。
  // 改为按名字精确点选「[测试]勾亚-幼体」（无历史测量日志），断言只看「新出现的 48.5/21 记录」。
  const picked = await p.eval(`(() => {
    const cells = [...document.querySelectorAll('.growth-cell')];
    const t = cells.find(c => (c.querySelector('.gc-name') || {}).textContent.includes('勾亚-幼体'));
    if (!t) return null;
    t.click();
    return t.dataset.id;
  })()`);
  ok('成长记录网格可点选指定个体', !!picked, String(picked));
  // 轮询等选中态生效（.picked + 记录按钮就绪）
  await p.eval(`new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      if (document.querySelector('.growth-cell.picked') && document.getElementById('g-record')) return res();
      if (Date.now() - t0 > 10000) return rej(new Error('个体选中态未生效'));
      setTimeout(poll, 100);
    })();
  })`, { awaitPromise: true });
  const g2 = await p.eval(`({
    w: !!document.getElementById('g-weight'),
    l: !!document.getElementById('g-length'),
    rec: !!document.getElementById('g-record'),
  })`);
  ok('选中个体后出现 体重/体长/记录', g2.w && g2.l && g2.rec, JSON.stringify(g2));
  // 从「已选中」单元格读 ID（而非第一个单元格，避免重渲染后错位）
  const gid = await p.eval(`document.querySelector('.growth-cell.picked').dataset.id`);
  const before = await p.eval(`(async () => { const m = await import('./js/store.js'); return m.listLogs('${gid}', 'measure').length; })()`, { awaitPromise: true });
  await p.eval(`document.getElementById('g-weight').value = '48.5'; document.getElementById('g-length').value = '21'; document.getElementById('g-record').click()`, { awaitPromise: false });
  // 轮询等日志写入 + 重渲染出曲线（addLog 落库后页面才 render，两者有先后，必须一起等）
  // 注意：listLogs 按 createTime 降序返回，新记录在数组头部，不能取末位当「最新」
  const g3 = await p.eval(`(async () => {
    const m = await import('./js/store.js');
    const t0 = Date.now();
    const hit = () => {
      const ms = m.listLogs('${gid}', 'measure');
      const rec = ms.find(l => Number(l.data.weight) === 48.5 && Number(l.data.length) === 21) || null;
      return { n: ms.length, rec };
    };
    while (Date.now() - t0 < 8000) {
      const { n, rec } = hit();
      const chartOk = !!document.querySelector('#g-trend svg');
      if (rec && chartOk) return { n, last: rec.data, hasChart: chartOk };
      await new Promise((r) => setTimeout(r, 100));
    }
    const { n, rec } = hit();
    return { n, last: rec ? rec.data : null, hasChart: !!document.querySelector('#g-trend svg') };
  })()`, { awaitPromise: true });
  ok('记录按钮写入测量日志（体重48.5/体长21）', g3.n === before + 1 && g3.last && Number(g3.last.weight) === 48.5 && Number(g3.last.length) === 21, JSON.stringify(g3));
  ok('记录后曲线图渲染', g3.hasChart === true, '');

  // 5. 饲养日志页
  await p.goto(BASE + '#/logs', 900);
  const l1 = await p.eval(`({ badges: document.querySelectorAll('.log-badge').length, rows: document.querySelectorAll('#view .row').length })`);
  ok('饲养日志页渲染喂食/医疗记录', l1.badges > 0 && l1.rows > 0, JSON.stringify(l1));
  await p.eval(`document.getElementById('lg-type').value = 'feed'; document.getElementById('lg-type').dispatchEvent(new Event('change'))`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 300))`, { awaitPromise: true });
  const l2 = await p.eval(`[...document.querySelectorAll('.log-badge')].every((b) => b.textContent === '喂食')`);
  ok('饲养日志类型筛选（仅喂食）', l2 === true, '');

  // 6. 首页喂养记录按钮 + 完整弹窗流程
  await p.goto(BASE + '#/home', 900);
  const hasBtn = await p.eval(`!!document.getElementById('btn-feeding')`);
  ok('首页新增「喂养记录」按钮', hasBtn === true, '');
  await p.eval(`document.getElementById('btn-feeding').click()`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 400))`, { awaitPromise: true });
  const m1 = await p.eval(`!!document.getElementById('ff-feed') && !!document.getElementById('ff-med')`);
  ok('弹窗第一步：喂食/医疗二选一', m1 === true, '');
  await p.eval(`document.getElementById('ff-feed').click()`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 400))`, { awaitPromise: true });
  const m2 = await p.eval(`({ rows: document.querySelectorAll('.pick-row').length, plan: !!document.getElementById('ff-plan'), species: !!document.getElementById('ff-species') })`);
  ok('弹窗第二步：全个体列表 + 爬柜/物种筛选 + 多选', m2.rows > 0 && m2.plan && m2.species, JSON.stringify(m2));
  // 勾选前两只 + 确定
  await p.eval(`document.querySelectorAll('.pick-row')[0].click(); document.querySelectorAll('.pick-row')[1].click()`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 200))`, { awaitPromise: true });
  const cnt = await p.eval(`document.getElementById('ff-count').textContent`);
  ok('多选计数更新（2 只）', cnt === '2', cnt);
  await p.eval(`[...document.querySelectorAll('.modal-mask .m-foot button')].find((b) => b.textContent === '确定记录').click()`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 600))`, { awaitPromise: true });
  // v3.3：选完个体后会弹出喂食表单，需填食物后保存，才会为每个个体各生成一条记录
  const feedFormShown = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    return !!(m && m.querySelector('#lg-food-pick') && m.querySelector('#lg-qty'));
  })()`);
  ok('选个体后弹出喂食表单（v3.3 新增步骤）', feedFormShown === true, '');
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const sel = m.querySelector('#lg-food-pick');
    const target = [...sel.options].find((o) => o.value);
    if (target) { sel.value = target.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const q = m.querySelector('#lg-qty'); if (q) q.value = '2 只';
    [...m.querySelectorAll('.m-foot .btn')].find((b) => b.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 900))`, { awaitPromise: true });
  const fed = await p.eval(`(async () => { const m = await import('./js/store.js'); return m.S.animal_log.filter((l) => l.logType === 'feed').length; })()`, { awaitPromise: true });
  ok('表单保存后为每个选中个体批量写入喂食记录', fed >= 2, String(fed));

  // 7. 蛋孵化预填新建个体
  const eggId = await p.eval(`(async () => { const m = await import('./js/store.js'); const e = m.S.egg[0]; return e ? e.id : ''; })()`, { awaitPromise: true });
  ok('存在测试蛋记录', !!eggId, eggId);
  await p.goto(BASE + '#/animal/new?hatch=' + eggId, 1000);
  const pf = await p.eval(`({
    title: document.querySelector('.page-title').textContent,
    species: document.getElementById('f-species').value,
    mother: document.getElementById('f-mother').value,
    father: document.getElementById('f-father').value,
    birth: document.getElementById('f-birth').value,
  })`);
  const today = new Date(); const td = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  ok('孵化预填：标题/物种/母本/父本/出生日期', pf.title.includes('孵化登记') && pf.species && pf.mother && pf.birth === td, JSON.stringify(pf));

  // 8. 蛋详情标记孵化 → 跳转新建（数据流）
  await p.goto(BASE + '#/egg/' + eggId, 900);
  await p.eval(`(async () => { const m = await import('./js/store.js'); const e = m.S.egg[0]; if (e) await m.updateEgg(e.id, { status: 'fertile' }); })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + eggId, 900);
  await p.eval(`document.getElementById('f-status').value = 'hatched'; document.getElementById('f-status').dispatchEvent(new Event('change'))`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 300))`, { awaitPromise: true });
  // confirmDialog 自动弹出 → 点「确定并归档」
  await p.eval(`(async () => { const btn = [...document.querySelectorAll('.modal-mask .m-foot button')].find((b) => b.textContent.includes('确定')); if (btn) btn.click(); })()`, { awaitPromise: false });
  await p.eval(`new Promise(r => setTimeout(r, 700))`, { awaitPromise: true });
  const hatchFlow = await p.eval(`location.hash`);
  ok('标记孵化后自动跳转新建个体（带 hatch 参数）', hatchFlow.startsWith('#/animal/new?hatch='), hatchFlow);

  // 9. 控制台错误
  ok('控制台零错误', p.consoleErrors.length === 0, p.consoleErrors.slice(0, 3).join(' | '));
});

const fail = R.filter(([, c]) => !c);
R.forEach(([n, c, d]) => console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)));
console.log(`汇总: ${R.length - fail.length}/${R.length} 通过`);
process.exit(fail.length ? 1 : 0);
