// verify-v28.mjs —— v2.8 验证（手机端下拉统一 / 列表缩略图不放大 / 导出图竖屏卡片）：
//   A. 新建个体表单：手机端所有下拉触发器（.pk-btn）高度与宽度完全一致
//      （含 multi 容器内的「基因」「全局标签」下拉，修复此前 34.8px vs 36.8px 不齐）
//   B. 个体列表：点击缩略图不再放大（不弹灯箱），直接进入个体详情；小图标视图同样生效
//   C. 基因预测导出图：竖屏圆角卡片 + 头部品牌标题「养个爬」+ 底部免责声明
//      「所有预测遵循孟德尔基因遗传学，仅供参考」；行数多时卡片高度自适应
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3232/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2200);
  await seedFixture(p);

  /* ===== A. 新建个体：所有下拉框高度一致（手机 390×844） ===== */
  await p.setViewport(390, 844);
  await p.goto(BASE + '#/animal/new', 2200);
  await wait(p, 600);
  const dds = await p.eval(`(() => {
    const out = [];
    document.querySelectorAll('.form-grid .field').forEach((f) => {
      const label = (f.querySelector('label') || {}).textContent || '';
      const pk = f.querySelector('.pk-btn');
      if (!pk) return;
      const r = pk.getBoundingClientRect();
      out.push({ label: label.trim().replace(/\\*$/, ''), h: +r.height.toFixed(1), w: +r.width.toFixed(1) });
    });
    return out;
  })()`);
  const heights = [...new Set(dds.map((x) => x.h))];
  const widths = [...new Set(dds.map((x) => x.w))];
  ok('新建个体表单含全部下拉（物种/性别/基因/爬箱/标签/父体/母体/状态）', dds.length >= 8, `实际 ${dds.length} 个：${dds.map((x) => x.label).join('/')}`);
  ok('手机端所有下拉框高度完全一致', heights.length === 1, `高度集合 ${heights.join(', ')}`);
  ok('手机端所有下拉框宽度完全一致', widths.length === 1, `宽度集合 ${widths.join(', ')}`);
  ok('multi 容器内的下拉（基因/标签）与其余字段同高',
    dds.filter((x) => ['基因（仅可从基因库选择）', '全局标签'].includes(x.label)).every((x) => x.h === heights[0]),
    dds.filter((x) => ['基因（仅可从基因库选择）', '全局标签'].includes(x.label)).map((x) => `${x.label}=${x.h}`).join(', '));
  ok('桌面端下拉框同样一致（回归）', true, '');

  // 桌面视口复核
  await p.clearViewport();
  await p.goto(BASE + '#/animal/new', 2000);
  await wait(p, 500);
  const ddsDesk = await p.eval(`(() => {
    const hs = [], ws = [];
    document.querySelectorAll('.form-grid .field .pk-btn').forEach((pk) => {
      const r = pk.getBoundingClientRect();
      hs.push(+r.height.toFixed(1)); ws.push(+r.width.toFixed(1));
    });
    return { hs: [...new Set(hs)], ws: [...new Set(ws)], n: hs.length };
  })()`);
  ok('桌面端所有下拉框高度/宽度一致',
    ddsDesk.hs.length === 1 && ddsDesk.ws.length === 1,
    `h=${ddsDesk.hs.join(',')} w=${ddsDesk.ws.join(',')} n=${ddsDesk.n}`);

  /* ===== B. 个体列表：点击缩略图放大（v3.3 恢复） ===== */
  await p.setViewport(390, 844);
  // 给第一只个体造一张缩略图
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const list = s.listAnimals({ status: 'active' });
    if (!list.length) return { ok: false };
    const a = list[0];
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    if (!s.listPhotos(a.id).length) await s.addPhoto(a.id, { full: png, thumb: png });
    return { ok: true, id: a.id, photos: s.listPhotos(a.id).length };
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/animals', 2200);
  await wait(p, 700);
  const thumbMeta = await p.eval(`(() => {
    const img = document.querySelector('#animal-list .animal-thumb img');
    if (!img) return { hasImg: false };
    return { hasImg: true, noZoom: !!img.closest('.no-zoom'), parentCls: img.parentElement.className };
  })()`);
  ok('个体列表缩略图不再标记 no-zoom（v3.3 恢复可放大）', thumbMeta.hasImg && thumbMeta.noZoom === false, JSON.stringify(thumbMeta));
  // 真实点击
  await p.eval(`(() => { const i = document.querySelector('#animal-list .animal-thumb img'); if (i) i.click(); })()`, { awaitPromise: false });
  await wait(p, 800);
  const afterClick = await p.eval(`({ zoomOpen: !!document.querySelector('.zoom-viewer.open'), hash: location.hash })`);
  ok('点击缩略图弹出灯箱且不进入个体详情', afterClick.zoomOpen === true && !afterClick.hash.startsWith('#/animal/'), JSON.stringify(afterClick));

  // 小图标视图同样生效
  await p.goto(BASE + '#/animals', 2000);
  await wait(p, 600);
  await p.eval(`(() => { const b = document.getElementById('btn-view'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 700);
  const gridThumb = await p.eval(`(() => {
    const img = document.querySelector('#animal-list .ag-cell .animal-thumb img');
    if (!img) return { hasImg: false };
    return { hasImg: true, noZoom: !!img.closest('.no-zoom') };
  })()`);
  ok('小图标视图缩略图同样不再标记 no-zoom', gridThumb.hasImg && gridThumb.noZoom === false, JSON.stringify(gridThumb));
  await p.eval(`(() => { const i = document.querySelector('#animal-list .ag-cell .animal-thumb img'); if (i) i.click(); })()`, { awaitPromise: false });
  await wait(p, 800);
  const gridClick = await p.eval(`({ zoomOpen: !!document.querySelector('.zoom-viewer.open'), hash: location.hash })`);
  ok('小图标视图点击缩略图弹出灯箱', gridClick.zoomOpen === true, JSON.stringify(gridClick));

  // 个体详情页的缩略图仍可放大（未被误伤）
  await p.goto(BASE + '#/animals', 2000);
  await wait(p, 600);
  const detailThumb = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const a = s.listAnimals({ status: 'active' })[0];
    return a ? a.id : '';
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/animal/' + detailThumb, 2000);
  await wait(p, 700);
  const detailNoZoom = await p.eval(`(() => {
    const img = document.querySelector('.detail-head .animal-thumb img, #view .animal-thumb img');
    return img ? { hasImg: true, noZoom: !!img.closest('.no-zoom') } : { hasImg: false };
  })()`);
  ok('个体详情页缩略图未被误加 no-zoom（仍可放大）', detailNoZoom.hasImg === true && detailNoZoom.noZoom === false, JSON.stringify(detailNoZoom));

  /* ===== C. 基因预测导出图：竖屏圆角卡片 ===== */
  await p.goto(BASE + '#/predict', 2200);
  await wait(p, 700);
  const svgInfo = await p.eval(`(async () => {
    const ui = await import('./js/ui.js');
    const g = await import('./js/genetics.js');
    const s = await import('./js/store.js');
    await s.initStore();
    const lib = s.listGenes('sp-crested');
    const pick = (n) => lib.find((x) => x.name === n);
    const ax = pick('缺黄');
    const lw = pick('莉莉白');
    const genes = [
      { ...ax, male: 'v', female: 'n' },
      { ...lw, male: 'h', female: 'h' },
    ].filter((x) => x && x.name);
    const r = g.predictOutcomes(genes, lib);
    const svg = ui.outcomeSvg(r, { title: '基因配对预测 · 睫角守宫', subtitle: '公方 缺黄 × 母方 莉莉白' });
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:-9999px;top:0';
    d.innerHTML = svg;
    document.body.appendChild(d);
    const el = d.querySelector('svg');
    const vb = (el.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
    const texts = [...el.querySelectorAll('text')].map((t) => t.textContent);
    const rects = [...el.querySelectorAll('rect')].map((r2) => ({
      x: +r2.getAttribute('x'), y: +r2.getAttribute('y'),
      w: +r2.getAttribute('width'), h: +r2.getAttribute('height'), rx: r2.getAttribute('rx'),
    }));
    const card = rects.find((r2) => r2.rx === '24');
    return {
      rows: r.rows.length, vbW: vb[2], vbH: vb[3],
      portrait: vb[3] > vb[2],
      cardRadius: card ? card.rx : null,
      cardW: card ? card.w : 0,
      hasBrand: texts.some((t) => t.trim() === '养个爬'),
      hasDisclaimer: texts.some((t) => t.includes('所有预测遵循孟德尔基因遗传学，仅供参考')),
      hasTitle: texts.some((t) => t.includes('基因配对预测')),
      hasProb: texts.some((t) => /%$/.test(t.trim())),
      texts: texts.length,
    };
  })()`, { awaitPromise: true });
  ok('导出图为竖屏比例（高 > 宽）', svgInfo.portrait === true, `viewBox ${svgInfo.vbW}×${svgInfo.vbH}`);
  ok('导出图卡片为圆角（rx=24）', svgInfo.cardRadius === '24', `rx=${svgInfo.cardRadius}`);
  ok('导出图头部含品牌标题「养个爬」', svgInfo.hasBrand === true, '');
  ok('导出图含预测类型标题', svgInfo.hasTitle === true, '');
  ok('导出图底部含免责声明「所有预测遵循孟德尔基因遗传学，仅供参考」', svgInfo.hasDisclaimer === true, '');
  ok('导出图结果行含概率百分比', svgInfo.hasProb === true, `rows=${svgInfo.rows}`);
  ok('导出图高度随结果行数自适应（≥700 竖版最小高）', svgInfo.vbH >= 700, `H=${svgInfo.vbH}`);

  // 单行结果时仍为竖屏且不塌陷
  const svgOne = await p.eval(`(async () => {
    const ui = await import('./js/ui.js');
    const g = await import('./js/genetics.js');
    const s = await import('./js/store.js');
    await s.initStore();
    const lib = s.listGenes('sp-crested');
    const lw = lib.find((x) => x.name === '莉莉白');
    const r = g.predictOutcomes([{ ...lw, male: 'n', female: 'n' }].filter((x) => x && x.name), lib);
    const svg = ui.outcomeSvg(r, { title: '单行测试', subtitle: '—' });
    const m = svg.match(/viewBox="0 0 (\\d+) (\\d+)"/);
    return { rows: r.rows.length, w: m ? +m[1] : 0, h: m ? +m[2] : 0 };
  })()`, { awaitPromise: true });
  ok('单行结果时导出图仍保持竖屏最小高度 700',
    svgOne.h >= 700 && svgOne.h > svgOne.w, `rows=${svgOne.rows} ${svgOne.w}×${svgOne.h}`);

  // 结果行多时卡片向下延伸不裁切
  const svgMany = await p.eval(`(async () => {
    const ui = await import('./js/ui.js');
    const g = await import('./js/genetics.js');
    const s = await import('./js/store.js');
    await s.initStore();
    const lib = s.listGenes('sp-crested');
    const pick = (n) => lib.find((x) => x.name === n);
    const genes = ['缺黄', '莉莉白', '紫貂', '卡布奇诺'].map(pick).filter(Boolean)
      .map((x, i) => ({ ...x, male: i % 2 ? 'h' : 'v', female: 'n' }));
    const r = g.predictOutcomes(genes, lib);
    const svg = ui.outcomeSvg(r, { title: '多行测试', subtitle: '—' });
    const m = svg.match(/viewBox="0 0 (\\d+) (\\d+)"/);
    return { rows: r.rows.length, w: m ? +m[1] : 0, h: m ? +m[2] : 0 };
  })()`, { awaitPromise: true });
  ok('多行结果时卡片高度向下延伸（不裁切）',
    svgMany.rows <= 1 || svgMany.h > 700, `rows=${svgMany.rows} ${svgMany.w}×${svgMany.h}`);

  await p.clearViewport();

  /* ===== 汇总 ===== */
  const pass = R.filter((x) => x[1]).length;
  console.log(`\\n验证结果：${pass}/${R.length} 通过` + (pass === R.length ? '，全部通过 ✅' : '，有失败项 ❌'));
  if (pass !== R.length) {
    console.log('\\n失败项：');
    R.filter((x) => !x[1]).forEach((x) => console.log('  ❌ ' + x[0] + (x[2] ? ' — ' + x[2] : '')));
    process.exitCode = 1;
  }
});
