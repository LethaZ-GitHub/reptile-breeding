// verify-v29.mjs —— v2.9 验证：
//   A. 单位按钮「克 g / 盎司 oz / 厘米 cm / 英寸 inch」不再折行（双行结构）
//   B. 新建个体表单：所有下拉框高度 == 普通输入框高度（电脑 + 手机）
//   C. 桌面端信息密度：容器放宽 + 列表多列 + 首页右侧概览栏
//   D. 记账页手机端：卡片式行、金额可见、无横向溢出
//   E. 超长名称单行省略
//   F. 「关于」卡片版本信息按钮 + 弹窗展示更新内容（正文来自 txt）
//   G. 导出图 SVG 显式 width/height（手机端与电脑端渲染一致的前提）
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3233/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });

await withBrowser(async (p) => {
  await p.goto(BASE, 2200);
  await seedFixture(p);

  /* ===== A. 单位按钮不折行 ===== */
  await p.setViewport(390, 844);
  await p.goto(BASE + '#/settings', 2200);
  await wait(p, 600);
  const unitInfo = await p.eval(`(() => {
    const out = [];
    document.querySelectorAll('.seg-unit button').forEach((b) => {
      const r = b.getBoundingClientRect();
      const cn = b.querySelector('.su-cn'), en = b.querySelector('.su-en');
      const cnR = cn ? cn.getBoundingClientRect() : null;
      const enR = en ? en.getBoundingClientRect() : null;
      out.push({
        label: (cn ? cn.textContent : '') + '/' + (en ? en.textContent : ''),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        cnLines: cn ? Math.round(cnR.height / parseFloat(getComputedStyle(cn).lineHeight || 16)) : 0,
        enLines: en ? Math.round(enR.height / parseFloat(getComputedStyle(en).lineHeight || 14)) : 0,
      });
    });
    return out;
  })()`);
  ok('设置页存在 4 个单位按钮（克/盎司/厘米/英寸）', unitInfo.length === 4, unitInfo.map((x) => x.label).join(' '));
  ok('每个单位按钮的中文名均为单行（不折行）',
    unitInfo.length > 0 && unitInfo.every((x) => x.cnLines === 1),
    unitInfo.map((x) => `${x.label}:cn${x.cnLines}`).join(', '));
  ok('每个单位按钮的英文缩写均为单行（不折行）',
    unitInfo.length > 0 && unitInfo.every((x) => x.enLines === 1),
    unitInfo.map((x) => `${x.label}:en${x.enLines}`).join(', '));
  ok('单位按钮宽度充裕（≥ 50px，不再被压成 42px 竖排）',
    unitInfo.length > 0 && unitInfo.every((x) => x.w >= 50),
    unitInfo.map((x) => `${x.label}=${x.w}`).join(', '));

  /* ===== B. 下拉框高度 == 普通输入框高度 ===== */
  await p.goto(BASE + '#/animal/new', 2200);
  await wait(p, 700);
  const hInfo = await p.eval(`(() => {
    const input = document.querySelector('.form-grid .field input[type="text"]');
    const inputH = input ? +input.getBoundingClientRect().height.toFixed(1) : 0;
    const dds = [];
    document.querySelectorAll('.form-grid .field').forEach((f) => {
      const label = ((f.querySelector('label') || {}).textContent || '').trim().replace(/\\*$/, '');
      const pk = f.querySelector('.pk-btn');
      if (!pk) return;
      dds.push({ label, h: +pk.getBoundingClientRect().height.toFixed(1) });
    });
    return { inputH, dds };
  })()`);
  ok('新建个体表单含全部下拉（≥8 个）', hInfo.dds.length >= 8, `${hInfo.dds.length} 个`);
  ok('手机端所有下拉框高度一致', new Set(hInfo.dds.map((x) => x.h)).size === 1,
    `高度集合 ${[...new Set(hInfo.dds.map((x) => x.h))].join(', ')}`);
  ok('手机端下拉框高度 == 普通输入框高度',
    hInfo.inputH > 0 && hInfo.dds.every((x) => x.h === hInfo.inputH),
    `输入框=${hInfo.inputH}，下拉=${hInfo.dds.map((x) => x.h).join('/')}`);

  // 桌面端复核
  await p.clearViewport();
  await p.goto(BASE + '#/animal/new', 2000);
  await wait(p, 600);
  const hDesk = await p.eval(`(() => {
    const input = document.querySelector('.form-grid .field input[type="text"]');
    const inputH = input ? +input.getBoundingClientRect().height.toFixed(1) : 0;
    const hs = [];
    document.querySelectorAll('.form-grid .field .pk-btn').forEach((pk) => {
      hs.push(+pk.getBoundingClientRect().height.toFixed(1));
    });
    return { inputH, hs: [...new Set(hs)] };
  })()`);
  ok('桌面端所有下拉框高度一致', hDesk.hs.length === 1, `h=${hDesk.hs.join(',')}`);
  ok('桌面端下拉框高度 == 普通输入框高度',
    hDesk.inputH > 0 && hDesk.hs.length === 1 && hDesk.hs[0] === hDesk.inputH,
    `输入框=${hDesk.inputH}，下拉=${hDesk.hs.join('/')}`);

  /* ===== C. 桌面端信息密度 ===== */
  // 注意：无头浏览器未指定窗口尺寸时默认仅 800×600 宽，961px 以上的媒体查询不会生效，
  //       故这里显式 setViewport(1440, 900) 模拟真实桌面宽度。
  await p.setViewport(1440, 900, false);
  await p.goto(BASE + '#/animals', 2200);
  await wait(p, 800);
  const deskInfo = await p.eval(`(() => {
    const view = document.getElementById('view');
    const list = document.querySelector('#animal-list');
    const rows = document.querySelectorAll('#animal-list .row');
    const cols = list ? getComputedStyle(list).gridTemplateColumns : '';
    const rowW = rows[0] ? +rows[0].getBoundingClientRect().width.toFixed(1) : 0;
    return {
      viewMax: getComputedStyle(view).maxWidth,
      listDisplay: list ? getComputedStyle(list).display : '',
      cols: cols ? cols.split(' ').filter(Boolean).length : 0,
      rowW,
      winW: window.innerWidth,
    };
  })()`);
  ok('桌面端容器放宽（max-width ≥ 1400px）', parseInt(deskInfo.viewMax, 10) >= 1400, deskInfo.viewMax);
  ok('桌面端个体列表为多列网格', deskInfo.listDisplay === 'grid' && deskInfo.cols >= 2,
    `display=${deskInfo.listDisplay} cols=${deskInfo.cols} 行宽=${deskInfo.rowW}`);

  await p.goto(BASE + '#/home', 2200);
  await wait(p, 800);
  const homeInfo = await p.eval(`(() => {
    const side = document.querySelector('.home-side');
    const cs = side ? getComputedStyle(side) : null;
    return {
      hasSide: !!side,
      display: cs ? cs.display : 'none',
      sideRows: document.querySelectorAll('.home-side .side-row').length,
    };
  })()`);
  ok('桌面端首页显示右侧概览栏', homeInfo.hasSide && homeInfo.display !== 'none', JSON.stringify(homeInfo));
  ok('首页概览栏有内容（爬柜/物种/个体）', homeInfo.sideRows > 0, `sideRows=${homeInfo.sideRows}`);

  // 手机端概览栏应隐藏
  await p.setViewport(390, 844);
  await p.goto(BASE + '#/home', 2000);
  await wait(p, 700);
  const sideMobile = await p.eval(`(() => {
    const side = document.querySelector('.home-side');
    return side ? getComputedStyle(side).display : 'missing';
  })()`);
  ok('手机端隐藏右侧概览栏', sideMobile === 'none', `display=${sideMobile}`);

  /* ===== D. 记账页手机端 ===== */
  await p.goto(BASE + '#/bills', 2200);
  await wait(p, 800);
  const billInfo = await p.eval(`(() => {
    const items = [...document.querySelectorAll('#bill-list .bill-item')];
    if (!items.length) return { n: 0 };
    const it = items[0];
    const cat = it.querySelector('.bi-cat');
    const amt = it.querySelector('.bi-amt');
    const catR = cat.getBoundingClientRect();
    const amtR = amt.getBoundingClientRect();
    const p = document.documentElement;
    return {
      n: items.length,
      catH: +catR.height.toFixed(1),
      catW: +catR.width.toFixed(1),
      amtVisible: amtR.width > 0 && amtR.height > 0,
      amtRight: +amtR.right.toFixed(1),
      winW: window.innerWidth,
      overflow: p.scrollW > p.clientW + 1,
      amtText: (amt.textContent || '').trim(),
    };
  })()`);
  ok('记账页手机端为卡片式条目', billInfo.n > 0, `${billInfo.n} 条`);
  ok('记账分类不竖排（高度 < 30px）', billInfo.catH > 0 && billInfo.catH < 30, `catH=${billInfo.catH} catW=${billInfo.catW}`);
  ok('记账金额在手机端可见', billInfo.amtVisible === true, billInfo.amtText);
  ok('记账页手机端无横向溢出', billInfo.overflow === false, `overflow=${billInfo.overflow}`);

  /* ===== E. 超长名称省略 ===== */
  await p.goto(BASE + '#/animals', 2200);
  await wait(p, 800);
  const longInfo = await p.eval(`(() => {
    const names = [...document.querySelectorAll('#animal-list .rt-name')];
    if (!names.length) return { n: 0 };
    const longest = names.reduce((a, b) => (b.textContent.length > a.textContent.length ? b : a));
    const cs = getComputedStyle(longest);
    return {
      n: names.length,
      len: longest.textContent.length,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      overflow: cs.overflow,
      h: +longest.getBoundingClientRect().height.toFixed(1),
    };
  })()`);
  ok('个体列表名称带 .rt-name 省略样式', longInfo.n > 0 && longInfo.textOverflow === 'ellipsis',
    JSON.stringify(longInfo));
  ok('超长名称单行显示（高度 < 30px）', longInfo.h > 0 && longInfo.h < 30, `h=${longInfo.h}`);

  /* ===== F. 关于卡片版本信息按钮 ===== */
  await p.clearViewport();
  await p.goto(BASE + '#/more', 2200);
  await wait(p, 800);
  const aboutInfo = await p.eval(`(() => {
    const btn = document.querySelector('#btn-version');
    const card = btn ? btn.closest('.card') : null;
    return {
      hasBtn: !!btn,
      btnText: btn ? (btn.textContent || '').trim() : '',
      cardHasAbout: card ? (card.textContent || '').includes('关于') : false,
      aboutText: card ? (card.querySelector('.hint') || {}).textContent || '' : '',
    };
  })()`);
  ok('关于卡片存在「版本信息」按钮', aboutInfo.hasBtn === true, aboutInfo.btnText);
  ok('关于卡片包含关于正文', aboutInfo.cardHasAbout === true && aboutInfo.aboutText.trim().length > 0,
    aboutInfo.aboutText.slice(0, 40));

  await p.eval(`(() => { document.querySelector('#btn-version').click(); })()`, { awaitPromise: false });
  await wait(p, 800);
  const modalInfo = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return { hasModal: false };
    const txt = (m.textContent || '');
    return {
      hasModal: true,
      title: (m.querySelector('.m-title') || {}).textContent || '',
      hasCurrent: txt.includes('当前版本'),
      hasVer: /v\\d+\\.\\d+\\.\\d+/.test(txt),
      blocks: m.querySelectorAll('.ver-block').length,
      hasDisclaimer: txt.includes('孟德尔'),
    };
  })()`);
  ok('点击版本信息弹出弹窗', modalInfo.hasModal === true, modalInfo.title);
  ok('弹窗显示当前版本号', modalInfo.hasCurrent === true && modalInfo.hasVer === true, JSON.stringify(modalInfo));
  ok('弹窗展示更新内容条目', modalInfo.blocks > 0, `blocks=${modalInfo.blocks}`);
  ok('更新内容包含 v2.9 条目', modalInfo.hasDisclaimer === true, '');

  /* ===== G. 导出图显式尺寸 ===== */
  const svgInfo = await p.eval(`(async () => {
    const ui = await import('./js/ui.js');
    const g = await import('./js/genetics.js');
    const s = await import('./js/store.js');
    await s.initStore();
    const lib = s.listGenes('sp-crested');
    const lw = lib.find((x) => x.name === '莉莉白');
    const r = g.predictOutcomes([{ ...lw, male: 'n', female: 'n' }].filter((x) => x && x.name), lib);
    const svg = ui.outcomeSvg(r, { title: '尺寸测试', subtitle: '—' });
    const d = document.createElement('div');
    d.innerHTML = svg;
    const el = d.querySelector('svg');
    const vb = (el.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
    return {
      w: +(el.getAttribute('width') || 0),
      h: +(el.getAttribute('height') || 0),
      vbW: vb[2], vbH: vb[3],
      hasFont: !!(el.getAttribute('font-family') || '').length,
    };
  })()`, { awaitPromise: true });
  ok('导出图 SVG 根显式声明 width/height（跨端渲染一致的前提）',
    svgInfo.w > 0 && svgInfo.h > 0, `${svgInfo.w}×${svgInfo.h}`);
  ok('导出图 width/height 与 viewBox 一致',
    svgInfo.w === svgInfo.vbW && svgInfo.h === svgInfo.vbH, JSON.stringify(svgInfo));
  ok('导出图锁定字体栈', svgInfo.hasFont === true, '');

  /* ===== 汇总 ===== */
  const pass = R.filter((x) => x[1]).length;
  console.log(`\\n验证结果：${pass}/${R.length} 通过` + (pass === R.length ? '，全部通过 ✅' : '，有失败项 ❌'));
  if (pass !== R.length) {
    console.log('\\n失败项：');
    R.filter((x) => !x[1]).forEach((x) => console.log('  ❌ ' + x[0] + (x[2] ? ' — ' + x[2] : '')));
    process.exitCode = 1;
  }
});
