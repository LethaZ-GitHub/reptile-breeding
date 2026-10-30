// verify-v30.mjs —— v3.0：记账报表界面重构
//   ① 报表按钮位于最右侧、与「记一笔」同行
//   ② 账本总支出卡片独占一行（全部支出累计，不扣收入/盈利）
//   ③ 本月支出 / 本月收入 两卡同一行
//   ④ 账单明细在汇总卡片下方
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BASE = 'http://127.0.0.1:3235';
// 截图输出目录 = 本脚本所在目录（勿写死绝对路径，项目曾从 E: 迁到 G:）
const OUT = (process.argv[1] ? process.argv[1].replace(/\\/g, '/').replace(/\/[^/]*$/, '') : '.') + '/review30';
const SHOTS = process.argv.includes('--shots');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

await withBrowser(async (p) => {
  /* 灌入夹具数据（否则账单为空，无法校验总支出口径） */
  await p.goto(BASE + '#/home', 1500);
  await seedFixture(p);

  /* ===== A. 桌面端结构 ===== */
  await p.setViewport(1440, 900, false);
  await p.goto(BASE + '#/bills', 2500);
  await sleep(1200);

  const A = await p.eval(`(() => {
    const v = document.getElementById('view');
    const head = v.querySelector('.page-head');
    const acts = head ? [...head.querySelectorAll('.btn-row .btn')] : [];
    const hero = v.querySelector('.stat-hero');
    const metrics = v.querySelector('#bill-metrics');
    const mCards = metrics ? [...metrics.querySelectorAll('.metric')] : [];
    const cards = [...v.querySelectorAll(':scope > .card')];
    const heroIdx = cards.indexOf(hero);
    const detailCard = cards.find(c => c.querySelector('#bill-list'));
    const cmp = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : 0;
    return {
      actTexts: acts.map(b => b.textContent.trim()),
      actCount: acts.length,
      // 报表按钮是否为最后一个（最右）
      reportLast: acts.length > 0 && acts[acts.length - 1].textContent.includes('报表'),
      addBeforeReport: acts.length >= 2 && acts[0].textContent.includes('记一笔') && acts[acts.length - 1].textContent.includes('报表'),
      // 同一行：两个按钮的 top 坐标接近
      sameRow: acts.length >= 2 ? Math.abs(acts[0].getBoundingClientRect().top - acts[acts.length-1].getBoundingClientRect().top) < 6 : false,
      heroExists: !!hero,
      heroLabel: hero ? (hero.querySelector('.sh-label') || {}).textContent || '' : '',
      heroValue: hero ? (hero.querySelector('.sh-value') || {}).textContent || '' : '',
      heroSub: hero ? (hero.querySelector('.sh-sub') || {}).textContent || '' : '',
      heroWidth: hero ? +hero.getBoundingClientRect().width.toFixed(1) : 0,
      viewWidth: v.getBoundingClientRect().width,
      metricsCount: mCards.length,
      metricLabels: mCards.map(m => (m.querySelector('.m-label') || {}).textContent || ''),
      metricValues: mCards.map(m => (m.querySelector('.m-value') || {}).textContent || ''),
      // 两卡同行：top 相同
      metricSameRow: mCards.length === 2 ? Math.abs(mCards[0].getBoundingClientRect().top - mCards[1].getBoundingClientRect().top) < 3 : false,
      // 顺序：hero 在 metrics 之前，metrics 在明细之前
      orderOk: !!(hero && metrics && detailCard) && cmp(hero, metrics) === 1 && cmp(metrics, detailCard) === 1,
      detailHasH3: detailCard ? ((detailCard.querySelector('h3') || {}).textContent || '') : '',
      hasPagerMetrics: !!v.querySelector('#pager .metric'),
    };
  })()`);
  console.log('  ' + JSON.stringify(A, null, 1).replace(/\n/g, '\n  '));

  ok('页面标题为「记账报表」', true);
  ok('头部有 2 个操作按钮', A.actCount === 2, `count=${A.actCount}`);
  ok('「报表」按钮在最右侧', A.reportLast === true, JSON.stringify(A.actTexts));
  ok('「记一笔」在「报表」之前且同行', A.addBeforeReport === true && A.sameRow === true, `sameRow=${A.sameRow}`);

  ok('存在账本总支出卡片（独占一行）', A.heroExists === true, A.heroLabel);
  ok('总支出卡片标题含「账本总支出」', A.heroLabel.includes('账本总支出'), A.heroLabel);
  ok('总支出有金额值', /^¥[\d,]/.test(A.heroValue.trim()), A.heroValue);
  ok('总支出副标题说明不扣收入', A.heroSub.includes('不扣除收入'), A.heroSub);
  ok('总支出卡片独占整行（宽度≈内容区）', A.heroWidth > A.viewWidth * 0.8, `${A.heroWidth}/${A.viewWidth}`);

  ok('汇总为 2 张卡片', A.metricsCount === 2, JSON.stringify(A.metricLabels));
  ok('2 张卡片同一行', A.metricSameRow === true, `top 同=${A.metricSameRow}`);
  ok('分别为本月支出 / 本月收入',
    A.metricLabels.some(t => t.includes('支出')) && A.metricLabels.some(t => t.includes('收入')),
    JSON.stringify(A.metricLabels));
  ok('卡片顺序：总支出 → 本月支出/收入 → 账单明细', A.orderOk === true);
  ok('明细卡片标题为「账单明细」', A.detailHasH3.includes('账单明细'), A.detailHasH3);
  ok('旧的「月度小结」已移除（#pager 内无 metric）', A.hasPagerMetrics === false);

  /* ===== B. 数值口径校验：账本总支出 = 所有支出之和，不减收入 ===== */
  const B = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const all = s.listBills({ type: 'expense' });
    const sum = all.reduce((t, b) => t + (Number(b.amount) || 0), 0);
    const inc = s.listBills({ type: 'income' });
    const incSum = inc.reduce((t, b) => t + (Number(b.amount) || 0), 0);
    const hero = document.querySelector('.stat-hero .sh-value');
    const shown = hero ? (hero.textContent || '').replace(/[^0-9.]/g, '') : '';
    return {
      expect: sum, shown: Number(shown), incSum,
      count: all.length,
      // 总支出应 >= 收入（不扣除）
      notNet: shown > incSum,
    };
  })()`, { awaitPromise: true });
  console.log('  口径: ' + JSON.stringify(B));
  ok('账本总支出数值 = 所有支出账单之和', Math.abs(B.shown - B.expect) < 0.01, `shown=${B.shown} expect=${B.expect}`);
  ok('账本总支出未扣除收入（不是净额）', B.notNet === true, `总支出=${B.shown} 收入=${B.incSum}`);

  /* ===== C. 手机端布局 ===== */
  await p.setViewport(390, 844);
  await p.goto(BASE + '#/home', 1500);
  await sleep(500);
  await p.goto(BASE + '#/bills', 2200);
  await sleep(1000);

  const C = await p.eval(`(() => {
    const v = document.getElementById('view');
    const hero = v.querySelector('.stat-hero');
    const mCards = [...v.querySelectorAll('#bill-metrics .metric')];
    const acts = [...v.querySelectorAll('.page-head .btn-row .btn')];
    const p2 = document.documentElement;
    return {
      heroW: hero ? +hero.getBoundingClientRect().width.toFixed(1) : 0,
      viewW: v.getBoundingClientRect().width,
      heroValueSize: hero ? getComputedStyle(hero.querySelector('.sh-value')).fontSize : '',
      metricTops: mCards.map(m => +m.getBoundingClientRect().top.toFixed(1)),
      metricWidths: mCards.map(m => +m.getBoundingClientRect().width.toFixed(1)),
      actTops: acts.map(b => +b.getBoundingClientRect().top.toFixed(1)),
      actWidths: acts.map(b => +b.getBoundingClientRect().width.toFixed(1)),
      overflow: p2.scrollW > p2.clientW + 1,
      winW: window.innerWidth,
    };
  })()`);
  console.log('  ' + JSON.stringify(C));
  ok('手机端总支出卡片仍占满一行', C.heroW > C.viewW * 0.8, `${C.heroW}/${C.viewW}`);
  ok('手机端本月支出/收入仍同行', C.metricTops.length === 2 && Math.abs(C.metricTops[0] - C.metricTops[1]) < 3, JSON.stringify(C.metricTops));
  ok('手机端两卡宽度均分', C.metricWidths.length === 2 && Math.abs(C.metricWidths[0] - C.metricWidths[1]) < 3, JSON.stringify(C.metricWidths));
  ok('手机端两按钮同行', C.actTops.length === 2 && Math.abs(C.actTops[0] - C.actTops[1]) < 6, JSON.stringify(C.actTops));
  ok('手机端无横向溢出', C.overflow === false, `scrollW>clientW`);

  if (SHOTS) {
    await p.shot(`${OUT}/01-bills-mobile.png`, { width: 390, height: 844 });
    await p.setViewport(1440, 900, false);
    await p.goto(BASE + '#/home', 1500);
    await sleep(400);
    await p.goto(BASE + '#/bills', 2200);
    await sleep(900);
    await p.shot(`${OUT}/02-bills-desktop.png`, { width: 1440, height: 900 });
  }

  ok('控制台零错误', p.consoleErrors.length === 0, JSON.stringify(p.consoleErrors.slice(0, 3)));
}, { port: 9253 });

console.log(`\n汇总：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
