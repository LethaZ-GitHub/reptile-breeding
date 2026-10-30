// verify-v18.mjs —— 本轮验证：内置基因库重建（仅孟德尔四类）/ 爬箱内个体卡片+X移出 / 入箱弹窗筛选+多选
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3222/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const lastModal = () => `[...document.querySelectorAll('.modal')].pop()`;
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 内置基因库重建：仅显性/隐性/不完全显性/复合 ===== */
  const geneSeed = await p.eval(`(async () => {
    const sc = await import('./js/schema.js');
    const s = await import('./js/store.js');
    await s.initStore();
    const seed = sc.seedGene();
    return {
      types: [...new Set(seed.map((g) => g.type))].sort(),
      cTotal: seed.filter((g) => g.speciesId === 'sp-crested').length,
      hTotal: seed.filter((g) => g.speciesId === 'sp-hognose').length,
      cNames: seed.filter((g) => g.speciesId === 'sp-crested').map((g) => g.name),
      hNames: seed.filter((g) => g.speciesId === 'sp-hognose').map((g) => g.name),
      polyType: !!sc.GENE_TYPES.polygenic,
      comboOfFrap: (seed.find((g) => g.name === '法布奇诺') || {}).comboOf || [],
    };
  })()`, { awaitPromise: true });
  ok('种子基因仅含孟德尔类型（无多基因选育）',
    geneSeed.types.length > 0 && geneSeed.types.every((t) => ['dominant', 'recessive', 'incomplete', 'combo', 'het'].includes(t)),
    JSON.stringify(geneSeed.types));
  // v3.5：新增杂合（het）派生项 —— 睫角 16 + 2 het = 18；猪鼻蛇 17 + 11 het = 28
  ok('睫角守宫内置 16 项 + 2 个杂合派生 = 18 项', geneSeed.cTotal === 18, String(geneSeed.cTotal));
  ok('猪鼻蛇内置 17 项 + 11 个杂合派生 = 28 项', geneSeed.hTotal === 28, String(geneSeed.hTotal));
  ok('杂合基因名称为「隐」+ 隐性基因名',
    geneSeed.cNames.includes('隐缺黄') && geneSeed.cNames.includes('隐巧克力')
    && geneSeed.hNames.includes('隐白化') && geneSeed.hNames.includes('隐真海波'),
    JSON.stringify(geneSeed.cNames.concat(geneSeed.hNames).filter((n) => n.startsWith('隐'))));
  ok('多基因内置项已移除（淡纹/高对比/奶油/褪纹/超红）',
    !['淡纹', '高对比', '奶油', '褪纹', '超红'].some((n) => geneSeed.cNames.includes(n) || geneSeed.hNames.includes(n)),
    JSON.stringify(geneSeed.cNames.concat(geneSeed.hNames)));
  ok('v2.0 起「多基因选育」类型已取消注册', !geneSeed.polyType, '');
  ok('法布奇诺复合组分为 卡布奇诺+莉莉白',
    geneSeed.comboOfFrap.join('+') === '卡布奇诺+莉莉白', JSON.stringify(geneSeed.comboOfFrap));

  // 下线内置基因（无人引用）→ 同步后自动删除
  const legacyDel = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    await s.initStore();
    const fake = { id: 'gn-c-fadingpattern', speciesId: 'sp-crested', name: '淡纹', en: 'Fading Pattern', type: 'polygenic', desc: 'x', isCustom: false, createdAt: 'seed' };
    await db.dbPut('gene', fake);
    s.S.gene.push(fake);
    const r = await s.syncBuiltinGenes();
    const inMem = s.listGenes('sp-crested').some((g) => g.id === 'gn-c-fadingpattern');
    const inDb = (await db.dbAll('gene')).some((g) => g.id === 'gn-c-fadingpattern');
    return { r, inMem, inDb };
  })()`, { awaitPromise: true });
  ok('下线内置基因（无人引用）同步后自动删除', legacyDel.r.removed >= 1 && !legacyDel.inMem && !legacyDel.inDb, JSON.stringify(legacyDel));

  // 被个体引用的下线内置基因 → 保留不删（防引用悬空）
  const legacyKeep = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const fake = { id: 'gn-h-superred', speciesId: 'sp-hognose', name: '超红', en: 'Super Red', type: 'polygenic', desc: 'x', isCustom: false, createdAt: 'seed' };
    await db.dbPut('gene', fake);
    s.S.gene.push(fake);
    const a = await s.createAnimal({ name: 'V18引用个体${T}', speciesId: 'sp-hognose', sex: 'female', geneIds: ['gn-h-superred'] });
    const r = await s.syncBuiltinGenes();
    const inMem = s.listGenes('sp-hognose').some((g) => g.id === 'gn-h-superred');
    return { r, inMem, aid: a.id };
  })()`, { awaitPromise: true });
  ok('被个体引用的下线内置基因保留不删', legacyKeep.inMem && legacyKeep.r.removed === 0, JSON.stringify(legacyKeep));

  // 用户自定义基因不受内置重建影响
  const customKeep = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const g = await s.createGene({ speciesId: 'sp-crested', name: 'V18自定义基因${T}', en: 'CCG${T}', type: 'combo', desc: 't' });
    const r = await s.syncBuiltinGenes();
    return { id: g.id, kept: s.listGenes('sp-crested').some((x) => x.id === g.id), removed: r.removed };
  })()`, { awaitPromise: true });
  ok('用户自定义基因不受重建影响', customKeep.kept && customKeep.removed === 0, JSON.stringify(customKeep));

  /* ===== B. 爬箱详情：箱内个体卡片（一行两张 + ✕ 移出） ===== */
  const setup = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const plan = await s.createPlan('V18爬柜${T}', { capacity: 3, lastCleanAt: u.todayStr() });
    const cage = await s.createCage(plan.id, { zone: 'adult', note: 'V18测试箱' });
    const mk = async (name, sex, speciesId) => (await s.createAnimal({ name, speciesId: speciesId || 'sp-crested', sex })).id;
    const inA = await mk('V18箱内甲${T}', 'female');
    const inB = await mk('V18箱内乙${T}', 'male');
    await s.bindAnimalToCage(inA, cage.id);
    await s.bindAnimalToCage(inB, cage.id);
    const freeC = await mk('V18待选丙${T}', 'female');
    const freeD = await mk('V18待选丁${T}', 'male');
    const freeE = await mk('V18猪鼻戊${T}', 'female', 'sp-hognose');
    return { planId: plan.id, cageId: cage.id, ids: { inA, inB, freeC, freeD, freeE } };
  })()`, { awaitPromise: true });

  await p.goto(BASE + '#/cage/' + setup.planId, 1200);
  await p.eval(`document.querySelector('.cage-cell').click()`, { awaitPromise: false });
  await wait(p, 500);
  const occ1 = await p.eval(`(() => {
    const m = ${lastModal()};
    const grid = m.querySelector('#occ-grid');
    const cards = [...grid.querySelectorAll('.occ-card')];
    return {
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      count: cards.length,
      hasX: cards.every((c) => !!c.querySelector('.occ-x')),
      names: cards.map((c) => c.querySelector('.oc-name').textContent),
      countTxt: (m.querySelector('#occ-count') || {}).textContent,
      hasAddBtn: !!m.querySelector('#pv-add'),
    };
  })()`);
  ok('爬箱详情箱内个体以卡片展示', occ1.count === 2 && occ1.names.every((n) => n.includes('V18箱内')), JSON.stringify(occ1.names));
  ok('个体卡片一行两个', occ1.cols === 2, String(occ1.cols));
  ok('卡片右上角有移出按钮 ✕', occ1.hasX, JSON.stringify(occ1));
  ok('箱内计数与「＋ 放入个体」按钮存在', occ1.countTxt === '2' && occ1.hasAddBtn, JSON.stringify(occ1));

  // 点击 ✕ → 确认弹窗 → 移出
  await p.eval(`(() => {
    const m = ${lastModal()};
    const card = [...m.querySelectorAll('.occ-card')].find((c) => c.textContent.includes('V18箱内甲${T}'));
    card.querySelector('.occ-x').click();
  })()`, { awaitPromise: false });
  await wait(p, 400);
  const confirmTxt = await p.eval(`(() => {
    const m = ${lastModal()};
    return { title: (m.querySelector('.m-title') || {}).textContent, btns: [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent) };
  })()`);
  ok('移出前弹确认框（含个体名与「移出」按钮）', confirmTxt.title.includes('移出') && confirmTxt.btns.includes('移出'), JSON.stringify(confirmTxt));
  await p.eval(`(() => {
    const m = ${lastModal()};
    [...m.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '移出').click();
  })()`, { awaitPromise: false });
  await wait(p, 600);
  const afterRm = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const m = ${lastModal()};
    return {
      n: s.animalsInCage('${setup.cageId}').length,
      cards: m.querySelectorAll('.occ-card').length,
      countTxt: (m.querySelector('#occ-count') || {}).textContent,
    };
  })()`, { awaitPromise: true });
  ok('确认后个体移出爬箱（库存 2→1，卡片同步减少）', afterRm.n === 1 && afterRm.cards === 1 && afterRm.countTxt === '1', JSON.stringify(afterRm));

  /* ===== C. 入箱选择弹窗：排除在箱个体 / 物种筛选 / 性别筛选 / 多选 ===== */
  await p.eval(`(() => { ${lastModal()}.querySelector('#pv-add').click(); })()`, { awaitPromise: false });
  await wait(p, 500);
  const pick1 = await p.eval(`(() => {
    const m = ${lastModal()};
    const items = [...m.querySelectorAll('.pick-item')];
    return {
      title: (m.querySelector('.m-title') || {}).textContent,
      names: items.map((i) => i.querySelector('.pi-name').textContent),
      metas: items.map((i) => i.querySelector('.pi-meta').textContent),
      hasSp: !!m.querySelector('#pk-sp'),
      hasSex: !!m.querySelector('#pk-sex'),
      hint: (m.querySelector('#pk-hint') || {}).textContent,
    };
  })()`);
  ok('入箱弹窗含物种与性别筛选', pick1.hasSp && pick1.hasSex, JSON.stringify({ hasSp: pick1.hasSp, hasSex: pick1.hasSex }));
  ok('已入箱个体不出现在选择列表（箱内乙被排除）',
    pick1.names.some((n) => n.includes(`V18待选丙${T}`)) && pick1.names.some((n) => n.includes(`V18待选丁${T}`))
    && !pick1.names.some((n) => n.includes(`V18箱内乙${T}`)),
    JSON.stringify(pick1.names.filter((n) => n.includes('V18'))));
  ok('刚移出的个体重新出现在可选列表', pick1.names.some((n) => n.includes(`V18箱内甲${T}`)), '');
  ok('提示文案说明已入箱个体不显示', pick1.hint.includes('已在箱内的个体不显示'), pick1.hint);

  // 物种筛选：仅猪鼻蛇
  await p.eval(`(() => {
    const m = ${lastModal()};
    const sel = m.querySelector('#pk-sp');
    sel.value = 'sp-hognose';
    sel.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 300);
  const pick2 = await p.eval(`(() => {
    const m = ${lastModal()};
    const items = [...m.querySelectorAll('.pick-item')];
    return { names: items.map((i) => i.querySelector('.pi-name').textContent), metas: items.map((i) => i.querySelector('.pi-meta').textContent) };
  })()`);
  ok('物种筛选仅展示猪鼻蛇个体', pick2.metas.length > 0 && pick2.metas.every((x) => x.includes('猪鼻蛇'))
    && pick2.names.some((n) => n.includes(`V18猪鼻戊${T}`)) && !pick2.names.some((n) => n.includes(`V18待选丙${T}`)),
    JSON.stringify(pick2.names.filter((n) => n.includes('V18'))));

  // 性别筛选（物种重置为全部）：仅母
  await p.eval(`(() => {
    const m = ${lastModal()};
    const sp = m.querySelector('#pk-sp');
    sp.value = '';
    sp.dispatchEvent(new Event('change'));
    const sx = m.querySelector('#pk-sex');
    sx.value = 'female';
    sx.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 300);
  const pick3 = await p.eval(`(() => {
    const m = ${lastModal()};
    const items = [...m.querySelectorAll('.pick-item')];
    return { names: items.map((i) => i.querySelector('.pi-name').textContent), metas: items.map((i) => i.querySelector('.pi-meta').textContent) };
  })()`);
  ok('性别筛选仅展示母个体', pick3.metas.length > 0 && pick3.metas.every((x) => x.trim().endsWith('母'))
    && pick3.names.some((n) => n.includes(`V18待选丙${T}`)) && !pick3.names.some((n) => n.includes(`V18待选丁${T}`)),
    JSON.stringify(pick3.names.filter((n) => n.includes('V18'))));

  // 重置性别，多选丙+丁 → 放入
  await p.eval(`(() => {
    const m = ${lastModal()};
    const sx = m.querySelector('#pk-sex');
    sx.value = '';
    sx.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 300);
  const clickItem = (name) => p.eval(`(() => {
    const m = ${lastModal()};
    const it = [...m.querySelectorAll('.pick-item')].find((i) => i.querySelector('.pi-name').textContent.includes('${name}'));
    if (it) it.click();
  })()`, { awaitPromise: false });
  await clickItem(`V18待选丙${T}`);
  await wait(p, 200);
  await clickItem(`V18待选丁${T}`);
  await wait(p, 300);
  const selState = await p.eval(`(() => {
    const m = ${lastModal()};
    return { on: m.querySelectorAll('.pick-item.on').length, okTxt: [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent) };
  })()`);
  ok('多选两只后选中态与按钮计数更新', selState.on === 2 && selState.okTxt.some((t) => t === '放入所选（2）'), JSON.stringify(selState));
  await p.eval(`(() => {
    const m = ${lastModal()};
    [...m.querySelectorAll('.m-foot .btn')].find((x) => x.textContent.startsWith('放入所选')).click();
  })()`, { awaitPromise: false });
  await wait(p, 800);
  const bound = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const list = s.animalsInCage('${setup.cageId}');
    return { n: list.length, names: list.map((a) => a.name) };
  })()`, { awaitPromise: true });
  ok('多选放入后两只个体均入箱（箱内共 3 只）',
    bound.n === 3 && bound.names.some((n) => n.includes(`V18待选丙${T}`)) && bound.names.some((n) => n.includes(`V18待选丁${T}`)),
    JSON.stringify(bound.names.filter((n) => n.includes('V18'))));

  // 放入后详情弹窗自动重开，展示 3 张卡片
  const occ2 = await p.eval(`(() => {
    const m = ${lastModal()};
    return { cards: m.querySelectorAll('.occ-card').length, countTxt: (m.querySelector('#occ-count') || {}).textContent };
  })()`);
  ok('放入后详情重开展示 3 张个体卡片', occ2.cards === 3 && occ2.countTxt === '3', JSON.stringify(occ2));

  // 再次打开选择弹窗：丙/丁已入箱 → 不再显示
  await p.eval(`(() => { ${lastModal()}.querySelector('#pv-add').click(); })()`, { awaitPromise: false });
  await wait(p, 500);
  const pick4 = await p.eval(`(() => {
    const m = ${lastModal()};
    const names = [...m.querySelectorAll('.pick-item .pi-name')].map((x) => x.textContent);
    return { names };
  })()`);
  ok('放入后重新打开弹窗，已入箱个体不再显示',
    !pick4.names.some((n) => n.includes(`V18待选丙${T}`) || n.includes(`V18待选丁${T}`) || n.includes(`V18箱内乙${T}`)),
    JSON.stringify(pick4.names.filter((n) => n.includes('V18'))));
  await p.eval(`(() => {
    const m = ${lastModal()};
    [...m.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '取消').click();
  })()`, { awaitPromise: false });
  await wait(p, 300);

  /* ---------- 汇总 ---------- */
  const pass = R.filter((r) => r[1]).length;
  console.log(`========== V1.8 汇总: ${pass}/${R.length} 通过 ==========`);
  const fails = R.filter((r) => !r[1]);
  if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  ❌ ' + f[0] + ' — ' + f[2])); }
});
