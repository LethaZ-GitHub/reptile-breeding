// verify-v15.mjs —— 本轮验证：自定义下拉选择器 / 睫角守宫新基因库 / N 编号规则 / 基因变更重编号 / 表现字段
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3218/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 自定义下拉选择器 ===== */
  await p.goto(BASE + '#/animal/new', 1200);
  const pk1 = await p.eval(`(() => {
    const sel = document.getElementById('f-species');
    const wrap = sel.parentNode;
    const btn = wrap.querySelector('.pk-btn');
    return {
      wrapped: wrap.classList.contains('pk-wrap'),
      hasBtn: !!btn,
      label: btn ? btn.querySelector('.pk-label').textContent : '',
      selHidden: sel.classList.contains('pk-native'),
      selValue: sel.value,
    };
  })()`);
  ok('原生 select 被包裹增强（.pk-wrap + .pk-btn）', pk1.wrapped && pk1.hasBtn && pk1.selHidden, JSON.stringify(pk1));
  ok('触发器标签显示当前选项', pk1.label.length > 0, pk1.label);

  // 点击触发器 → 弹层出现；选择第二项 → select.value 变更且标签同步
  await p.eval(`document.getElementById('f-species').parentNode.querySelector('.pk-btn').click()`, { awaitPromise: false });
  await wait(p, 350);
  const sheet = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    const opts = m ? [...m.querySelectorAll('.pk-opt')] : [];
    return { open: !!m, title: m ? m.querySelector('.m-title').textContent : '', optCount: opts.length, firstOpt: opts[0] ? opts[0].textContent.trim() : '' };
  })()`);
  ok('点击触发器弹出选项弹层', sheet.open && sheet.optCount >= 2 && sheet.title === '请选择', JSON.stringify(sheet));
  await p.eval(`(() => { const rows = [...document.querySelectorAll('.modal .pk-opt')]; rows.find(r => r.textContent.includes('猪鼻蛇')).click(); })()`, { awaitPromise: false });
  await wait(p, 250);
  const afterPick = await p.eval(`(() => {
    const sel = document.getElementById('f-species');
    return { v: sel.value, label: sel.parentNode.querySelector('.pk-label').textContent, modalGone: !document.querySelector('.modal') };
  })()`);
  ok('选择选项后值变更、标签同步、弹层关闭', afterPick.v === 'sp-hognose' && afterPick.label.includes('猪鼻蛇') && afterPick.modalGone, JSON.stringify(afterPick));

  // change 事件链路：状态选「已售出」→ 售出金额框显示（原 onchange 逻辑）
  await p.eval(`document.getElementById('f-status').parentNode.querySelector('.pk-btn').click()`, { awaitPromise: false });
  await wait(p, 300);
  await p.eval(`(() => { const rows = [...document.querySelectorAll('.modal .pk-opt')]; rows.find(r => r.textContent.includes('已售出')).click(); })()`, { awaitPromise: false });
  await wait(p, 250);
  const soldBox = await p.eval(`document.getElementById('sold-box').style.display`);
  ok('change 事件正常触发（状态→已售出显示金额框）', soldBox === 'contents', soldBox);

  // 动态重渲染的 select 仍被增强（物种切换后基因下拉重建）
  await p.eval(`document.getElementById('f-species').parentNode.querySelector('.pk-btn').click()`, { awaitPromise: false });
  await wait(p, 300);
  await p.eval(`(() => { const rows = [...document.querySelectorAll('.modal .pk-opt')]; rows.find(r => r.textContent.includes('睫角守宫')).click(); })()`, { awaitPromise: false });
  await wait(p, 400);
  const dynPk = await p.eval(`(() => {
    const gs = document.getElementById('f-gene-sel');
    if (!gs) return { exists: false };
    return { exists: true, wrapped: gs.parentNode.classList.contains('pk-wrap'), inMulti: gs.parentNode.parentNode.classList.contains('multi') };
  })()`);
  ok('动态渲染的基因下拉同样被增强', dynPk.exists && dynPk.wrapped, JSON.stringify(dynPk));

  // 多选容器内下拉：无边框风格 + 长列表（16 个基因）出搜索框
  await p.eval(`document.getElementById('f-gene-sel').parentNode.querySelector('.pk-btn').click()`, { awaitPromise: false });
  await wait(p, 350);
  const geneSheet = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return { q: !!m.querySelector('#pk-q'), optCount: m.querySelectorAll('.pk-opt').length };
  })()`);
  // v3.5：基因库新增杂合（het）派生项 —— 睫角守宫 16 内置 + 2 个 het（隐缺黄/隐巧克力）+ 占位项 = 19
  ok('基因下拉长列表带搜索框（16 内置 + 2 杂合 + 占位项）', geneSheet.q && geneSheet.optCount === 19, JSON.stringify(geneSheet));
  await p.eval(`document.querySelector('.modal .m-close').click()`, { awaitPromise: false });
  await wait(p, 200);

  /* ===== B. 睫角守宫基因库（新清单） ===== */
  const geneLib = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const c = s.listGenes('sp-crested').map(g => ({ name: g.name, en: g.en, type: g.type }));
    const h = s.listGenes('sp-hognose').map(g => g.name);
    return { crested: c, hognose: h, comboType: !!(await import('./js/schema.js')).GENE_TYPES.combo };
  })()`, { awaitPromise: true });
  const expect = [
    ['原色', 'Normal', 'dominant'],
    ['莉莉白', 'Lilly White', 'incomplete'], ['卡布奇诺', 'Cappuccino', 'incomplete'],
    ['高速公路', 'Highway', 'incomplete'], ['紫貂', 'Sable', 'incomplete'],
    ['缺黄', 'Axanthic', 'recessive'], ['巧克力', 'ChoCho', 'recessive'],
    ['法布奇诺', 'Frapuccino', 'combo'], ['缺黄莉莉', 'Axanthic Lilly White', 'combo'],
    ['缺黄卡布', 'Axanthic Cappuccino', 'combo'], ['缺黄紫貂莉莉', 'Axanthic Sable Lilly White', 'combo'],
    ['猫屎咖啡', 'Luwak', 'combo'], ['雪岳', 'Sorak', 'combo'],
    ['Highway莉莉白', 'Highway Lilly White', 'combo'], ['紫貂缺黄', 'Sable Axanthic', 'combo'],
    ['紫貂莉莉', 'Sable Lilly White', 'combo'],
  ];
  const libOk = geneLib.crested.filter((x) => x.type !== 'het').length === 16 && expect.every(([n, en, t]) => {
    const g = geneLib.crested.find((x) => x.name === n);
    return g && g.en === en && g.type === t;
  }) && expect.every(([n]) => geneLib.crested.some((g) => g.name === n));
  ok('睫角守宫基因库为指定 16 项（名称/英文/类型）', libOk, JSON.stringify(geneLib.crested.map((g) => g.name + ':' + g.type)));
  ok('复合基因类型已注册（GENE_TYPES.combo）', geneLib.comboType);
  // v3.5：猪鼻蛇 17 内置 + 11 个隐性派生的杂合基因 = 28
  ok('猪鼻蛇基因库为指定 17 项（孟德尔四类）+ 11 个杂合派生',
    geneLib.hognose.length === 28 && geneLib.hognose.includes('白化') && geneLib.hognose.includes('RBE蜡笔')
    && geneLib.hognose.includes('隐白化') && geneLib.hognose.includes('隐缺黄'),
    JSON.stringify(geneLib.hognose));

  // 内置基因同步：删掉「高速公路」后同步应补回；篡改类型后同步应恢复
  // v2.5 起内置基因禁改禁删（store.updateGene/removeGene 有守卫），这里改用 db 直改模拟存量脏数据
  const syncTest = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const hw = s.listGenes('sp-crested').find(g => g.en === 'Highway');
    await db.dbDel('gene', hw.id);
    s.S.gene = s.S.gene.filter((g) => g.id !== hw.id);
    const gone = !s.listGenes('sp-crested').some(g => g.en === 'Highway');
    const r1 = await s.syncBuiltinGenes();
    const back = s.listGenes('sp-crested').find(g => g.en === 'Highway');
    back.type = 'recessive';
    await db.dbPut('gene', back);
    await s.syncBuiltinGenes();
    return { gone, added: r1.added, restored: s.listGenes('sp-crested').find(g => g.en === 'Highway').type === 'incomplete' };
  })()`, { awaitPromise: true });
  ok('syncBuiltinGenes：删除后补回、篡改后恢复', syncTest.gone && syncTest.restored, JSON.stringify(syncTest));

  /* ===== C. 编号规则：无基因 → N；基因变更 → 按新基因重编号 ===== */
  const codeTest = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    // ① 无基因个体（守宫 & 蛇）→ N 前缀
    const noGene = await s.createAnimal({ name: 'V15无基因守宫${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [] });
    const noGeneSnake = await s.createAnimal({ name: 'V15无基因蛇${T}', speciesId: 'sp-hognose', sex: 'male', geneIds: [] });
    // ② 有基因个体 → 基因英文缩写
    const ax = s.listGenes('sp-crested').find(g => g.en === 'Axanthic');
    const withGene = await s.createAnimal({ name: 'V15缺黄守宫${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [ax.id] });
    const codeAx = withGene.code;
    // ③ 基因变更 → 按新基因重编号（序号取当前前缀最大号+1）
    const ph = s.listGenes('sp-crested').find(g => g.en === 'Sable');
    await s.updateAnimal(withGene.id, { geneIds: [ph.id] });
    const afterPh = s.getAnimal(withGene.id).code;
    const maxPh = s.S.animal.filter(a => a.code.startsWith('SA-')).map(a => +a.code.slice(3)).sort((x, y) => y - x)[0];
    // ④ 改为无基因 → N 前缀
    await s.updateAnimal(withGene.id, { geneIds: [] });
    const afterNone = s.getAnimal(withGene.id).code;
    // ⑤ 旧「物种前缀」编号迁移
    const albino = s.listGenes('sp-hognose').find(g => g.en === 'Albino');
    const legacy = await s.createAnimal({ name: 'V15旧编号蛇${T}', speciesId: 'sp-hognose', sex: 'female', geneIds: [albino.id] });
    await s.updateAnimal(legacy.id, { code: '猪鼻-001' });
    const legacy2 = await s.createAnimal({ name: 'V15旧编号守宫${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [] });
    await s.updateAnimal(legacy2.id, { code: '睫角-001' });
    const n = await s.normalizeAnimalCodes();
    return {
      noGene: noGene.code, noGeneSnake: noGeneSnake.code,
      codeAx, afterPh, maxPh, afterNone,
      legacy: s.getAnimal(legacy.id).code, legacy2: s.getAnimal(legacy2.id).code,
    };
  })()`, { awaitPromise: true });
  ok('无基因守宫编号为 N 前缀', /^N-\d{3}$/.test(codeTest.noGene), codeTest.noGene);
  ok('无基因蛇编号为 N 前缀', /^N-\d{3}$/.test(codeTest.noGeneSnake), codeTest.noGeneSnake);
  ok('有基因个体按基因英文缩写编号（AX-）', /^AX-\d{3}$/.test(codeTest.codeAx), codeTest.codeAx);
  ok('基因变更后按新基因重编号（SA-，序号为当前最大+1）', /^SA-\d{3}$/.test(codeTest.afterPh) && +codeTest.afterPh.slice(3) === codeTest.maxPh, `${codeTest.afterPh} max=${codeTest.maxPh}`);
  ok('改为无基因后编号为 N 前缀', /^N-\d{3}$/.test(codeTest.afterNone), codeTest.afterNone);
  ok('旧物种前缀编号迁移：有基因→AL-', /^AL-\d{3}$/.test(codeTest.legacy), codeTest.legacy);
  ok('旧物种前缀编号迁移：无基因→N-', /^N-\d{3}$/.test(codeTest.legacy2), codeTest.legacy2);

  /* ===== D. 表现（手动输入，可空） ===== */
  const phenoTest = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = await s.createAnimal({ name: 'V15表现守宫${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [], phenotype: '高白莉莉白纹' });
    const stored = s.getAnimal(a.id).phenotype;
    await s.updateAnimal(a.id, { phenotype: '' });
    const cleared = s.getAnimal(a.id).phenotype;
    await s.updateAnimal(a.id, { phenotype: '缺黄幻影' });
    return { stored, cleared, again: s.getAnimal(a.id).phenotype, id: a.id };
  })()`, { awaitPromise: true });
  ok('表现字段可创建/修改/清空', phenoTest.stored === '高白莉莉白纹' && phenoTest.cleared === '' && phenoTest.again === '缺黄幻影', JSON.stringify(phenoTest));
  // 表单含表现输入框；详情页展示
  const formHasPheno = await p.eval(`!!document.getElementById('f-pheno') && document.getElementById('f-pheno').tagName === 'INPUT'`);
  ok('新建个体表单含「表现」手动输入框', formHasPheno);
  await p.goto(BASE + '#/animal/' + phenoTest.id, 1000);
  const detailPheno = await p.eval(`document.getElementById('view').textContent`);
  ok('个体详情展示表现', detailPheno.includes('表现：缺黄幻影'), detailPheno.slice(0, 100));

  /* ===== E. 预测页：复合基因按组分参与计算（v2.3 弹窗三列结果） ===== */
  await p.goto(BASE + '#/predict', 1000);
  const predTest = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const combo = s.listGenes('sp-crested').find(g => g.en === 'Frapuccino');
    const ax = s.listGenes('sp-crested').find(g => g.en === 'Axanthic');
    const maleSel = document.querySelector('#male-box .g-sel');
    // v3.5：基因下拉为多选框 —— 需设置 option.selected（sel.value 对 multiple 无效）
    const mOpt = [...maleSel.options].find(o => o.value === combo.id);
    if (mOpt) mOpt.selected = true;
    maleSel.dispatchEvent(new Event('change'));
    const femaleSel = document.querySelector('#female-box .g-sel');
    const fOpt = [...femaleSel.options].find(o => o.value === ax.id);
    if (fOpt) fOpt.selected = true;
    femaleSel.dispatchEvent(new Event('change'));
    document.getElementById('btn-run').click();
    await new Promise(r => setTimeout(r, 500));
    const m = document.querySelector('.modal');
    if (!m) return { noModal: true };
    const rows = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { noModal: false, rows, txt: m.textContent };
  })()`, { awaitPromise: true });
  ok('预测页复合基因按组分计算（法布奇诺→卡布奇诺+莉莉白，与缺黄交叉；v2.4 起缺黄仅携带→名称带「隐」）',
    !predTest.noModal
      && predTest.rows.some((r) => r[0] === '25%' && r[2] === '卡布奇诺+隐缺黄')
      && predTest.rows.some((r) => r[0] === '25%' && r[2] === '莉莉白+隐缺黄')
      && predTest.rows.some((r) => r[0] === '25%' && r[2] === '卡布奇诺+莉莉白+隐缺黄')
      && predTest.rows.some((r) => r[0] === '25%' && r[2] === '隐缺黄')
      && /\d+%/.test(predTest.txt),
    JSON.stringify(predTest.rows));

  const errs = p.consoleErrors.filter((e) => !/favicon|service-worker/i.test(e));
  ok('控制台零错误', errs.length === 0, errs.slice(0, 3).join(' | '));
});

const pass = R.filter((r) => r[1]).length;
console.log(`\\n========== V1.5 汇总: ${pass}/${R.length} 通过 ==========`);
process.exit(pass === R.length ? 0 : 1);
