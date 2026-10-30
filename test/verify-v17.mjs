// verify-v17.mjs —— 回归验证：孟德尔预测引擎 / 个体基因状态 / 蛋详情基因预测
// （v2.0 起「多基因选育」类型已取消，原多基因断言改为「已移除 + 旧数据按隐性兼容」）
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3221/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 基因库：v2.0 取消多基因选育，仅剩孟德尔四类 ===== */
  const geneLib = await p.eval(`(async () => {
    const sc = await import('./js/schema.js');
    const s = await import('./js/store.js');
    await s.initStore();
    const cg = s.listGenes('sp-crested');
    const hg = s.listGenes('sp-hognose');
    return {
      hasPolyType: !!sc.GENE_TYPES.polygenic,
      typeCount: Object.keys(sc.GENE_TYPES).length,
      cPoly: cg.filter((g) => g.type === 'polygenic').map((g) => g.name).sort(),
      hPoly: hg.filter((g) => g.type === 'polygenic').map((g) => g.name).sort(),
      cTotal: cg.length,
    };
  })()`, { awaitPromise: true });
  // v3.5：新增「杂合（het）」类型 → GENE_TYPES 共 5 类（显性/隐性/杂合/不完全显性/复合）
  ok('v2.0 起基因类型不再含「多基因选育」', !geneLib.hasPolyType && geneLib.typeCount === 5, JSON.stringify(geneLib));
  ok('内置基因不含多基因选育（睫角）', geneLib.cPoly.length === 0, JSON.stringify(geneLib.cPoly));
  ok('内置基因不含多基因选育（猪鼻）', geneLib.hPoly.length === 0, JSON.stringify(geneLib.hPoly));

  // 基因库页不展示内置多基因基因；自定义弹窗不再含该类型
  await p.goto(BASE + '#/genes', 1000);
  const geneTbl = await p.eval(`document.getElementById('gene-tbl').innerText`);
  ok('基因库页表格不展示内置多基因选育基因', !geneTbl.includes('淡纹') && !geneTbl.includes('超红'), '');
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  await wait(p, 400);
  const typeOpts = await p.eval(`[...document.getElementById('g-type').options].map((o) => o.textContent)`);
  ok('自定义基因弹窗不再含「多基因选育」遗传方式', !typeOpts.some((t) => t.includes('多基因选育')), JSON.stringify(typeOpts));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '取消'); if (b) b.click(); })()`, { awaitPromise: false });

  /* ===== B. 孟德尔引擎单测 ===== */
  const eng = await p.eval(`(async () => {
    const g = await import('./js/genetics.js');
    const pct = (dist) => dist.map(([l, p]) => l + ':' + Math.round(p * 100)).sort().join('|');
    return {
      reHH: pct(g.geneOutcome('recessive', 'h', 'h')),
      reVH: pct(g.geneOutcome('recessive', 'v', 'h')),
      reVN: pct(g.geneOutcome('recessive', 'v', 'n')),
      reNN: pct(g.geneOutcome('recessive', 'n', 'n')),
      doVN: pct(g.geneOutcome('dominant', 'v', 'n')),
      doVV: pct(g.geneOutcome('dominant', 'v', 'v')),
      inSN: pct(g.geneOutcome('incomplete', 's', 'n')),
      inHH: pct(g.geneOutcome('incomplete', 'h', 'h')),
      inLegacyVN: pct(g.geneOutcome('incomplete', 'v', 'n')), // 老数据「表现」按单拷贝保守估算
      legacyPolyNN: pct(g.geneOutcome('polygenic', 'n', 'n')), // 旧多基因类型：按隐性表兜底
      legacyPolyOpts: g.geneStateOptions('polygenic').map((o) => o.value).join(','),
      comboHH: pct(g.geneOutcome('combo', 'h', 'h')),
      optDominant: g.geneStateOptions('dominant').map((o) => o.value).join(','),
      optIncomplete: g.geneStateOptions('incomplete').map((o) => o.value).join(','),
      optRecessive: g.geneStateOptions('recessive').map((o) => o.value).join(','),
    };
  })()`, { awaitPromise: true });
  ok('隐性 携带×携带 → 25%表现/50%携带/25%不携带', eng.reHH === 'h:50|n:25|v:25', eng.reHH);
  ok('隐性 纯合×携带 → 50%表现/50%携带', eng.reVH === 'h:50|v:50', eng.reVH);
  ok('隐性 纯合×不携带 → 100%携带', eng.reVN === 'h:100', eng.reVN);
  ok('隐性 不携带×不携带 → 100%不携带', eng.reNN === 'n:100', eng.reNN);
  ok('显性 表现×不携带 → 50%表现/50%不携带', eng.doVN === 'n:50|v:50', eng.doVN);
  ok('显性 表现×表现 → 100%表现', eng.doVV === 'v:100', eng.doVV);
  ok('不完全显性 超级体×不携带 → 100%携带', eng.inSN === 'h:100', eng.inSN);
  ok('不完全显性 携带×携带 → 25%超级体/50%携带/25%不携带', eng.inHH === 'h:50|n:25|s:25', eng.inHH);
  ok('不完全显性兼容旧「表现」值（按单拷贝估算：h×n → 50/50）', eng.inLegacyVN === 'h:50|n:50', eng.inLegacyVN);
  ok('旧多基因类型兜底按隐性表（n×n → 100%不携带）', eng.legacyPolyNN === 'n:100', eng.legacyPolyNN);
  ok('旧多基因类型状态选项退化为隐性三态', eng.legacyPolyOpts === 'v,h,n', eng.legacyPolyOpts);
  ok('复合基因按隐性近似（携带×携带 → 25/50/25）', eng.comboHH === 'h:50|n:25|v:25', eng.comboHH);
  ok('状态选项：显性无「携带」', eng.optDominant === 'v,n', eng.optDominant);
  ok('状态选项：不完全显性含「超级体」', eng.optIncomplete === 'h,s,n', eng.optIncomplete);
  ok('状态选项：隐性含表现/携带/不携带', eng.optRecessive === 'v,h,n', eng.optRecessive);

  /* ===== C. 基因状态字段已废止（v2.6：表单无状态选择 + 存量迁移剥字段） ===== */
  // 先建一个自定义不完全显性基因（后续蛋预测场景仍会用到）
  const incGene = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const g = await s.createGene({ speciesId: 'sp-crested', name: '测试不完全${T}', en: 'TInc${T}', type: 'incomplete', desc: '测试用' });
    return { id: g.id, name: g.name, type: g.type };
  })()`, { awaitPromise: true });

  await p.goto(BASE + '#/animal/new', 1000);
  const formInfo = await p.eval(`(() => ({
    hasStateWrap: !!document.getElementById('f-gene-state-wrap'),
    hasStateSel: !!document.getElementById('f-gene-state'),
    hasGeneSel: !!document.getElementById('f-gene-sel'),
    fields: [...document.querySelectorAll('.form-grid .field')].map((f) => (f.querySelector('label') || {}).textContent || ''),
  }))()`);
  ok('新建个体表单无基因状态选择器（v2.6 删除）', formInfo.hasStateWrap === false && formInfo.hasStateSel === false, JSON.stringify(formInfo));
  ok('新建个体表单仍保留基因单选', formInfo.hasGeneSel === true, '');

  // 选基因后依然不出现状态控件；保存后个体不带 geneState 字段
  await p.eval(`(() => {
    const sel = document.getElementById('f-gene-sel');
    sel.value = [...sel.options].find((o) => o.textContent.includes('测试不完全${T}')).value;
    sel.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 300);
  const afterPick = await p.eval(`(() => ({
    hasStateWrap: !!document.getElementById('f-gene-state-wrap'),
    hasStateSel: !!document.getElementById('f-gene-state'),
  }))()`);
  ok('选定基因后仍无基因状态控件', afterPick.hasStateWrap === false && afterPick.hasStateSel === false, JSON.stringify(afterPick));
  await p.eval(`(() => {
    document.getElementById('f-name').value = 'V17无状态个体${T}';
    document.getElementById('btn-save').click();
  })()`, { awaitPromise: false });
  await wait(p, 1200);
  const saved = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.listAnimals().find((x) => x.name === 'V17无状态个体${T}');
    return a ? { hasField: 'geneState' in a, geneId: a.geneIds[0], hash: location.hash } : null;
  })()`, { awaitPromise: true });
  ok('保存后个体不持久化 geneState 字段', saved && saved.hasField === false && saved.geneId === incGene.id, JSON.stringify(saved));
  const detailTxt = await p.eval(`document.getElementById('view').innerText`);
  ok('个体详情不再展示基因状态文案', !/（表现|携带|不携带|超级体）/.test(detailTxt), detailTxt.slice(0, 120));

  // 保存后记录个体 ID（后续分享测试按 ID 查找）
  const stateAnimalId = saved ? await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.listAnimals().find((x) => x.name === 'V17无状态个体${T}');
    return a ? a.id : null;
  })()`, { awaitPromise: true }) : null;

  // 迁移：专建一只带 geneState 的老个体（db 直写模拟 v2.5 及更早数据）→ 迁移后字段被剥掉
  const mig = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const gene = s.listGenes('sp-crested').find((g) => g.name === '缺黄');
    const a = await s.createAnimal({ name: 'V17迁移个体${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [gene.id] });
    a.geneState = 'h'; // 模拟老数据残留字段
    await db.dbPut('animal', a);
    const n = await s.stripGeneStates();
    const after = s.listAnimals().find((x) => x.id === a.id);
    const other = s.listAnimals().find((x) => x.id === '${stateAnimalId}');
    return { n, hasField: after && 'geneState' in after, otherOk: other && !('geneState' in other) };
  })()`, { awaitPromise: true });
  ok('存量个体 geneState 一次性迁移剥除', mig.n >= 1 && mig.hasField === false && mig.otherOk === true, JSON.stringify(mig));

  /* ===== D. 蛋详情基因预测（v2.6：个体不再登记基因状态，统一按类型取默认值） ===== */
  // 缺黄(隐性，默认纯合 v) × 缺黄(隐性，默认纯合 v) → 100% 显现
  const pair = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const gene = s.listGenes('sp-crested').find((g) => g.name === '缺黄');
    const m = await s.createAnimal({ name: 'V17母本${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [gene.id] });
    const f = await s.createAnimal({ name: 'V17父本${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [gene.id] });
    const egg = await s.createEgg({ motherId: m.id, fatherId: f.id, speciesId: 'sp-crested', layDate: u.todayStr() });
    return { eggId: egg.id, motherId: m.id, fatherId: f.id };
  })()`, { awaitPromise: true });

  await p.goto(BASE + '#/egg/' + pair.eggId, 1100);
  const gpredBtn = await p.eval(`(() => { const b = document.getElementById('btn-gpred'); return b ? b.textContent.trim() : null; })()`);
  ok('蛋详情页有「基因预测」按钮', gpredBtn === '🧬 基因预测', String(gpredBtn));

  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 500);
  const modal1 = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      title: (m.querySelector('.m-title') || {}).textContent || '',
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
      hasImg: !!m.querySelector('#gp-img'),
      hasStateSel: !!m.querySelector('.gp-st'),
    };
  })()`);
  ok('预测弹窗标题含孟德尔', modal1 && modal1.title.includes('孟德尔'), modal1 && modal1.title);
  ok('弹窗为新三列结果表（概率/基因性状/基因名称）且含导出图片',
    modal1 && modal1.rows.length >= 1 && modal1.hasImg, JSON.stringify(modal1 && modal1.rows));
  ok('缺黄×缺黄（默认纯合）→ 100% 显现(缺黄)',
    modal1 && modal1.rows.some((r) => r[0] === '100%' && r[1] === '缺黄' && r[2] === '缺黄'),
    JSON.stringify(modal1 && modal1.rows));

  // v2.3 起预测弹窗不再提供状态选择器；v2.6 起个体也不再登记基因状态
  ok('预测弹窗无基因状态选择器（v2.3 删除）', modal1 && !modal1.hasStateSel, JSON.stringify({ hasStateSel: modal1 && modal1.hasStateSel }));

  // 卡布奇诺(不完全显性，默认单拷贝 h) × 卡布奇诺 → 25% 超级 / 50% 卡布奇诺 / 25% 原色 + 健康风险
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);
  const capPair = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const gene = s.listGenes('sp-crested').find((g) => g.name === '卡布奇诺');
    const m = await s.createAnimal({ name: 'V17卡布母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [gene.id] });
    const f = await s.createAnimal({ name: 'V17卡布父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [gene.id] });
    const egg = await s.createEgg({ motherId: m.id, fatherId: f.id, speciesId: 'sp-crested', layDate: u.todayStr() });
    return egg.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + capPair, 1100);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 500);
  const modal2 = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return {
      warn: !!m.querySelector('.warn-box'),
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
    };
  })()`);
  ok('卡布奇诺×卡布奇诺 → 25% 超级卡布奇诺 / 50% 卡布奇诺 / 25% 原色（含健康风险）',
    !!modal2.warn && modal2.rows.some((r) => r[0] === '25%' && r[1] === '卡布奇诺+卡布奇诺' && r[2] === '超级卡布奇诺')
      && modal2.rows.some((r) => r[0] === '50%' && r[1] === '卡布奇诺' && r[2] === '卡布奇诺')
      && modal2.rows.some((r) => r[0] === '25%' && r[1] === '原色'),
    JSON.stringify(modal2.rows));

  // 莉莉白(不完全显性母) × 缺黄(隐性父) → 莉莉白+隐缺黄 50% / 隐缺黄 50%
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);
  const halfPair = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const lw = s.listGenes('sp-crested').find((g) => g.name === '莉莉白');
    const ax = s.listGenes('sp-crested').find((g) => g.name === '缺黄');
    const m = await s.createAnimal({ name: 'V17半携带母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [lw.id] });
    const f = await s.createAnimal({ name: 'V17半携带父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [ax.id] });
    const egg = await s.createEgg({ motherId: m.id, fatherId: f.id, speciesId: 'sp-crested', layDate: u.todayStr() });
    return egg.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + halfPair, 1100);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 500);
  const modal2b = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
  })()`);
  ok('莉莉白母 × 缺黄父 → 莉莉白+隐缺黄 50% / 隐缺黄 50%',
    modal2b.some((r) => r[0] === '50%' && r[1] === '莉莉白+缺黄' && r[2] === '莉莉白+隐缺黄')
      && modal2b.some((r) => r[0] === '50%' && r[1] === '缺黄' && r[2] === '隐缺黄'),
    JSON.stringify(modal2b));

  // 不完全显性默认单拷贝：测试不完全×测试不完全 → 25% 超级 / 50% / 25% 原色 + 风险警告
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);
  const superPair = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const g = s.listGenes('sp-crested').find((x) => x.name === '测试不完全${T}');
    const m = await s.createAnimal({ name: 'V17超母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [g.id] });
    const f = await s.createAnimal({ name: 'V17超父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [g.id] });
    const egg = await s.createEgg({ motherId: m.id, fatherId: f.id, speciesId: 'sp-crested', layDate: u.todayStr() });
    return egg.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + superPair, 1100);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 500);
  const modal3 = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return {
      txt: m.innerText.replace(/\\s+/g, ' '),
      warn: !!m.querySelector('.warn-box'),
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
    };
  })()`);
  ok('不完全显性默认单拷贝：测试不完全×测试不完全 → 25% 超级体（性状 X+X 表达式）并给出健康风险警告',
    modal3.rows.some((r) => r[0] === '25%' && r[2].startsWith('超级') && r[1].indexOf('测试不完全') === 0 && r[1].split('+').length === 2) && modal3.txt.includes('超级体') && modal3.warn,
    JSON.stringify({ warn: modal3.warn, rows: modal3.rows, txt: modal3.txt.slice(0, 120) }));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);

  // 无基因父母 → 空态引导
  const noGenePair = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const m = await s.createAnimal({ name: 'V17无基因母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [] });
    const f = await s.createAnimal({ name: 'V17无基因父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [] });
    const egg = await s.createEgg({ motherId: m.id, fatherId: f.id, speciesId: 'sp-crested', layDate: u.todayStr() });
    return egg.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + noGenePair, 1100);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 400);
  const modal4 = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return { txt: m.innerText.replace(/\\s+/g, ' '), btns: [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent) };
  })()`);
  ok('父母本均无基因时给出登记引导', modal4.txt.includes('均未登记基因') && modal4.btns.includes('去登记母本基因'), JSON.stringify(modal4.btns));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 200);

  /* ===== E. 分享包不再携带基因状态（v2.6 字段废止） ===== */
  const share = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.listAnimals().find((x) => x.id === '${stateAnimalId}');
    if (!a) return { err: 'animal not found' };
    const pkg = s.buildShare(a.id, {});
    const row = await s.importShare(pkg);
    const back = s.listAnimals().find((x) => x.id === row.animal.id);
    return { shareState: pkg.animal.geneState, importedHasField: back && 'geneState' in back, geneKept: back && back.geneIds[0] === a.geneIds[0] };
  })()`, { awaitPromise: true });
  ok('分享包导出/导入均不再带基因状态字段（基因本身保留）',
    share.shareState === undefined && share.importedHasField === false && share.geneKept === true, JSON.stringify(share));

  /* ---------- 汇总 ---------- */
  const pass = R.filter((r) => r[1]).length;
  console.log(`========== V1.7 汇总: ${pass}/${R.length} 通过 ==========`);
  const fails = R.filter((r) => !r[1]);
  if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  ❌ ' + f[0] + ' — ' + f[2])); }
});
