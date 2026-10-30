// verify-v20.mjs —— v2.0 本轮验证：
//  A. 取消多基因选育（schema / 基因库筛选 / 预测可选池 / 个体表单 / 创建接口 / 旧数据兼容）
//  B. 配对后产卵待办仅生成母本（创建 / 参与者增减 / 日期同步 / 删除级联 / 无母本）
//  C. 个体列表 列表 / 小图标 双视图切换
//  D. 喂食 / 医疗记录 全选 + 批量删除
//  E. 成长记录 历史记录弹窗（爬柜/物种/基因筛选 + 个体历史增删查改）
//  F. 基因预测 基因类别筛选 + 各基因显现概率 + 复合基因推导（法布奇诺）+ 蛋详情推导
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3224/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const lastModal = () => `[...document.querySelectorAll('.modal')].pop()`;
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 4500);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 取消多基因选育 ===== */
  const geneLib = await p.eval(`(async () => {
    const sc = await import('./js/schema.js');
    const s = await import('./js/store.js');
    await s.initStore();
    return {
      polyType: !!sc.GENE_TYPES.polygenic,
      typeCount: Object.keys(sc.GENE_TYPES).length,
      legacyFlag: sc.LEGACY_GENE_TYPE,
    };
  })()`, { awaitPromise: true });
  // v3.5：新增「杂合（het）」类型 → GENE_TYPES 共 5 类（显性/隐性/杂合/不完全显性/复合）
  ok('GENE_TYPES 已无多基因选育（仅孟德尔五类，含杂合）', !geneLib.polyType && geneLib.typeCount === 5, JSON.stringify(geneLib));
  ok('保留旧类型标识用于兼容展示', geneLib.legacyFlag === 'polygenic', JSON.stringify(geneLib));

  // 创建一个旧版多基因基因（直连 db 模拟存量数据），验证各入口不再展示/不再预测
  const legacyGene = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const fake = { id: 'gn-c-legacypoly${T}', speciesId: 'sp-crested', name: '旧多基因${T}', en: 'LegacyPoly${T}', type: 'polygenic', desc: '存量旧数据', isCustom: true, createdAt: '2026-01-01' };
    await db.dbPut('gene', fake);
    s.S.gene.push(fake);
    // createGene 拒绝多基因类型
    let createErr = '';
    try { await s.createGene({ speciesId: 'sp-crested', name: '新建多基因${T}', en: 'NP${T}', type: 'polygenic', desc: 'x' }); } catch (e) { createErr = e.message; }
    return { id: fake.id, name: fake.name, createErr };
  })()`, { awaitPromise: true });
  ok('createGene 拒绝新建多基因选育类型', /不支持的基因遗传类型/.test(legacyGene.createErr), legacyGene.createErr);

  // 基因库页：类型筛选 5 项且无多基因选育；存量多基因基因在「全部」下仍可见（只读兼容）
  await p.goto(BASE + '#/genes', 1200);
  const geneTypeSeg = await p.eval(`(() => {
    const seg = document.getElementById('f-type');
    return { items: [...seg.querySelectorAll('.seg-item')].map((x) => x.textContent) };
  })()`);
  // v3.5：新增「杂合」类型 → 基因库类型筛选为 6 项
  ok('基因库类型筛选为 6 项（无多基因选育，含杂合）',
    geneTypeSeg.items.length === 6 && !geneTypeSeg.items.some((t) => t.includes('多基因'))
    && geneTypeSeg.items.includes('杂合'),
    JSON.stringify(geneTypeSeg.items));
  const legacyInLib = await p.eval(`document.getElementById('gene-tbl').innerText.includes('旧多基因${T}')`);
  ok('存量多基因基因在基因库仍可见（只读兼容）', legacyInLib, '');

  // 自定义基因弹窗无多基因选育选项
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  await wait(p, 400);
  const typeOpts = await p.eval(`[...document.getElementById('g-type').options].map((o) => o.textContent)`);
  ok('自定义基因弹窗无「多基因选育」选项', !typeOpts.some((t) => t.includes('多基因选育')), JSON.stringify(typeOpts));
  // 复合基因弹窗含组分输入框
  await p.eval(`(() => { const s = document.getElementById('g-type'); s.value = 'combo'; s.dispatchEvent(new Event('change')); })()`, { awaitPromise: false });
  await wait(p, 200);
  const comboWrap = await p.eval(`(() => { const w = document.getElementById('g-combo-wrap'); return { display: w ? getComputedStyle(w).display : 'missing', hasInput: !!document.getElementById('g-combo') }; })()`);
  ok('选「复合」时显示组分输入框', comboWrap.display !== 'none' && comboWrap.hasInput, JSON.stringify(comboWrap));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '取消'); if (b) b.click(); })()`, { awaitPromise: false });

  // 个体表单基因下拉不含多基因（存量已选仍保留）
  const animalWithLegacy = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = await s.createAnimal({ name: 'V20旧多基因个体${T}', speciesId: 'sp-crested', sex: 'male', geneIds: ['gn-c-legacypoly${T}'], geneState: 'v' });
    return a.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/animal/edit/' + animalWithLegacy, 1200);
  const formGeneOpts = await p.eval(`(() => {
    const sel = document.getElementById('f-gene-sel');
    const opts = sel ? [...sel.options].map((o) => o.textContent) : [];
    return { hasLegacy: opts.some((t) => t.includes('旧多基因${T}')), hasLilly: opts.some((t) => t.includes('莉莉白')), hasFrap: opts.some((t) => t.includes('法布奇诺')) };
  })()`);
  ok('个体表单：已选旧多基因基因保留可见，其他基因正常', formGeneOpts.hasLegacy && formGeneOpts.hasLilly && formGeneOpts.hasFrap, JSON.stringify(formGeneOpts));

  /* ===== B. 配对产卵待办仅母本 ===== */
  const pairTodos = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const mk = async (name, sex) => (await s.createAnimal({ name, speciesId: 'sp-crested', sex })).id;
    const male = await mk('V20配公${T}', 'male');
    const femA = await mk('V20配母A${T}', 'female');
    const femB = await mk('V20配母B${T}', 'female');
    const unknown = await mk('V20配未知${T}', 'unknown');
    const nameOf = (id) => (s.S.animal.find((a) => a.id === id) || {}).name || '';
    const todosOf = (pid) => s.S.todo.filter((t) => t.sourceType === 'pairing-check' && t.sourceId === pid);

    // ① 一公一母 → 仅母本一条
    const p1 = await s.createPairing({ participants: [male, femA], pairDate: '2026-10-01', result: 'pending' });
    const t1 = todosOf(p1.id);
    const r1 = { n: t1.length, title: t1[0] ? t1[0].title : '', due: t1[0] ? t1[0].deadline : '', key: t1[0] ? t1[0].dedupeKey : '' };

    // ② 无母本（公+未知）→ 0 条
    const p2 = await s.createPairing({ participants: [male, unknown], pairDate: '2026-10-02', result: 'pending' });
    const r2 = { n: todosOf(p2.id).length };

    // ③ 编辑：再加一只母本 → 2 条；移除母本A → 剩母本B 1 条
    await s.updatePairing(p1.id, { participants: [male, femA, femB] });
    const r3 = { n: todosOf(p1.id).length, names: todosOf(p1.id).map((t) => t.title) };
    await s.updatePairing(p1.id, { participants: [male, femB] });
    const r4 = { n: todosOf(p1.id).length, names: todosOf(p1.id).map((t) => t.title) };

    // ④ 改日期 → 截止日同步（+20天）
    await s.updatePairing(p1.id, { pairDate: '2026-10-05' });
    const r5 = { dues: todosOf(p1.id).map((t) => t.deadline) };

    // ⑤ 删除配对 → 待办级联清除
    await s.removePairing(p1.id);
    const r6 = { n: todosOf(p1.id).length };

    return { r1, r2, r3, r4, r5, r6, expectDue: u.addDays('2026-10-05', 20), femAName: nameOf(femA), femBName: nameOf(femB), maleName: nameOf(male), p2id: p2.id };
  })()`, { awaitPromise: true });
  ok('一公一母配对只生成母本产卵待办（+20天）',
    pairTodos.r1.n === 1 && pairTodos.r1.title === '产卵检查：' + pairTodos.femAName
    && pairTodos.r1.due === '2026-10-21' && pairTodos.r1.key.includes(pairTodos.femAName.slice(-6)) === false,
    JSON.stringify(pairTodos.r1));
  ok('待办标题不含父本名字', !pairTodos.r1.title.includes(pairTodos.maleName), pairTodos.r1.title);
  ok('无母本配对不生成产卵待办', pairTodos.r2.n === 0, JSON.stringify(pairTodos.r2));
  ok('编辑配对新增母本 → 待办补齐为 2 条',
    pairTodos.r3.n === 2 && pairTodos.r3.names.some((t) => t.includes(pairTodos.femAName)) && pairTodos.r3.names.some((t) => t.includes(pairTodos.femBName)),
    JSON.stringify(pairTodos.r3));
  ok('编辑配对移除母本A → 其待办同步删除（剩母本B）',
    pairTodos.r4.n === 1 && pairTodos.r4.names[0].includes(pairTodos.femBName),
    JSON.stringify(pairTodos.r4));
  ok('修改配对日期 → 待办截止日同步（+20天）',
    pairTodos.r5.dues.length === 1 && pairTodos.r5.dues[0] === pairTodos.expectDue,
    JSON.stringify(pairTodos.r5));
  ok('删除配对 → 产卵待办级联清除', pairTodos.r6.n === 0, JSON.stringify(pairTodos.r6));

  /* ===== C. 个体列表 双视图 ===== */
  await p.goto(BASE + '#/animals', 1200);
  const viewBtn0 = await p.eval(`(() => { const b = document.getElementById('btn-view'); return b ? b.textContent : ''; })()`);
  ok('个体列表有视图切换按钮（默认列表，仅图标）', /^[📋🔲]$/u.test(viewBtn0), viewBtn0);
  await p.eval(`document.getElementById('btn-view').click()`, { awaitPromise: false });
  await wait(p, 300);
  const gridView = await p.eval(`(() => {
    const grid = document.querySelector('.animal-grid');
    const cells = grid ? [...grid.querySelectorAll('.ag-cell')] : [];
    const c0 = cells[0] || {};
    return {
      hasGrid: !!grid, n: cells.length,
      hasThumb: !!c0.querySelector('.animal-thumb'),
      name: c0.querySelector('.ag-name') ? c0.querySelector('.ag-name').textContent : '',
      sub0: c0.querySelectorAll('.ag-sub').length,
      sub1: c0.querySelectorAll('.ag-sub')[0] ? c0.querySelectorAll('.ag-sub')[0].textContent : '',
      sexIco: !!c0.querySelector('.sex-ico'),
      btnLabel: (document.getElementById('btn-view') || {}).textContent,
      ls: localStorage.getItem('rb-animal-view'),
    };
  })()`);
  ok('切到小图标：网格渲染且含缩略图/名字/编号/公母',
    gridView.hasGrid && gridView.n >= 5 && gridView.hasThumb && gridView.name.length > 0
    && gridView.sub0 === 2 && /-\d{3}/.test(gridView.sub1) && gridView.sexIco,
    JSON.stringify(gridView));
  ok('小图标视图按钮切换为列表图标并持久化', /^[📋🔲]$/u.test(gridView.btnLabel) && gridView.btnLabel === '📋' && gridView.ls === 'grid', JSON.stringify(gridView));
  await p.eval(`document.getElementById('btn-view').click()`, { awaitPromise: false });
  await wait(p, 300);
  const listView = await p.eval(`(() => ({
    hasGrid: !!document.querySelector('.animal-grid'),
    rows: document.querySelectorAll('#animal-list .row').length,
    ls: localStorage.getItem('rb-animal-view'),
  }))()`);
  ok('切回列表：现有行样式恢复', !listView.hasGrid && listView.rows >= 5, JSON.stringify(listView));
  // 小图标点击进入详情
  await p.eval(`document.getElementById('btn-view').click()`, { awaitPromise: false });
  await wait(p, 250);
  await p.eval(`document.querySelector('.animal-grid .ag-cell').click()`, { awaitPromise: false });
  await wait(p, 600);
  const detailHash = await p.eval(`location.hash`);
  ok('小图标单元格可点击进入个体详情', /^#\/animal\/.+/.test(detailHash), detailHash);
  await p.eval(`localStorage.setItem('rb-animal-view','list')`, { awaitPromise: false });

  /* ===== D. 喂食/医疗记录 全选 + 批量删除 ===== */
  const logSetup = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.S.animal.find((x) => x.name.includes('守宫-公子'));
    const before = s.S.animal_log.filter((l) => l.logType === 'feed').length;
    for (let i = 0; i < 5; i++) await s.addLog(a.id, 'feed', { food: 'V20全选测试' + i, amount: 1 });
    for (let i = 0; i < 2; i++) await s.addLog(a.id, 'medical', { note: 'V20医疗' + i });
    return { before, after: s.S.animal_log.filter((l) => l.logType === 'feed').length, med: s.S.animal_log.filter((l) => l.logType === 'medical').length };
  })()`, { awaitPromise: true });
  ok('预造喂食/医疗记录', logSetup.after === logSetup.before + 5 && logSetup.med >= 2, JSON.stringify(logSetup));

  await p.goto(BASE + '#/logs', 1200);
  const selAllBtn = await p.eval(`!!document.getElementById('lg-selall')`);
  ok('饲养日志页有全选按钮', selAllBtn, '');
  await p.eval(`document.getElementById('lg-selall').click()`, { awaitPromise: false });
  await wait(p, 300);
  const allChecked = await p.eval(`(() => {
    const boxes = [...document.querySelectorAll('.log-check')];
    return { total: boxes.length, checked: boxes.filter((b) => b.checked).length, bar: !!document.querySelector('.log-batch-bar'), barText: (document.querySelector('.log-batch-bar') || {}).textContent || '' };
  })()`);
  ok('全选后当前页记录全部勾选并出现批量操作栏',
    allChecked.total > 0 && allChecked.checked === allChecked.total && allChecked.bar && allChecked.barText.includes('已选'),
    JSON.stringify(allChecked));
  // 取消一条 → 批量栏计数减少
  await p.eval(`document.querySelector('.log-check').click()`, { awaitPromise: false });
  await wait(p, 300);
  const oneOff = await p.eval(`(() => { const boxes = [...document.querySelectorAll('.log-check')]; return { checked: boxes.filter((b) => b.checked).length, total: boxes.length }; })()`);
  ok('取消单条勾选后计数正确', oneOff.checked === oneOff.total - 1, JSON.stringify(oneOff));
  // 重新全选 → 批量删除（确认弹窗）
  await p.eval(`document.getElementById('lg-selall').click()`, { awaitPromise: false });
  await wait(p, 250);
  await p.eval(`document.getElementById('lg-batch-del').click()`, { awaitPromise: false });
  await wait(p, 400);
  const confirmTxt = await p.eval(`(${lastModal()}).textContent`);
  ok('批量删除前弹出确认框', confirmTxt.includes('批量') || confirmTxt.includes('删除'), confirmTxt.slice(0, 60));
  await p.eval(`(() => { const b = [...${lastModal()}.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '删除'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 500);
  const afterDel = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const feedLeft = s.S.animal_log.filter((l) => l.logType === 'feed' && (l.data.food || '').includes('V20全选测试')).length;
    return { feedLeft, bar: !!document.querySelector('.log-batch-bar') };
  })()`, { awaitPromise: true });
  ok('批量删除后当前页喂食记录被清除且操作栏消失',
    afterDel.feedLeft === 0 && !afterDel.bar, JSON.stringify(afterDel));

  /* ===== E. 成长记录 历史记录弹窗 ===== */
  // 准备：爬柜 + 物种 + 带基因个体 + 一条历史测量
  const growthSetup = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const plan = await s.createPlan('V20爬柜${T}', { capacity: 3, lastCleanAt: u.todayStr() });
    const cage = await s.createCage(plan.id, { zone: 'adult', note: 'V20箱' });
    const cap = s.listGenes('sp-crested').find((g) => g.name === '卡布奇诺');
    const a1 = await s.createAnimal({ name: 'V20成长甲${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [cap.id], geneState: 'v', weight: 40, length: 18 });
    const a2 = await s.createAnimal({ name: 'V20成长乙${T}', speciesId: 'sp-crested', sex: 'male', weight: 30, length: 15 });
    await s.bindAnimalToCage(a1.id, cage.id);
    await s.bindAnimalToCage(a2.id, cage.id);
    await s.addLog(a1.id, 'measure', { weight: 38, length: 17 }, '2026-09-01 10:00');
    await s.addLog(a1.id, 'measure', { weight: 41, length: 18.5 }, '2026-10-01 10:00');
    return { a1: a1.id, a2: a2.id, plan: plan.id, cap: cap.id };
  })()`, { awaitPromise: true });

  await p.goto(BASE + '#/growth', 1200);
  const histBtn = await p.eval(`!!document.getElementById('btn-history')`);
  ok('成长记录页右上角有历史记录按钮', histBtn, '');
  await p.eval(`document.getElementById('btn-history').click()`, { awaitPromise: false });
  await wait(p, 500);
  const histModal = await p.eval(`(() => {
    const m = ${lastModal()};
    return {
      title: m.querySelector('.m-title') ? m.querySelector('.m-title').textContent : '',
      hasPlan: !!m.querySelector('#h-plan'), hasSpecies: !!m.querySelector('#h-species'), hasGene: !!m.querySelector('#h-gene'),
      cells: m.querySelectorAll('.growth-cell').length,
    };
  })()`);
  ok('历史记录弹窗含爬柜/物种/基因筛选与个体网格',
    histModal.title.includes('历史') && histModal.hasPlan && histModal.hasSpecies && histModal.hasGene && histModal.cells >= 2,
    JSON.stringify(histModal));
  // 基因筛选：选卡布奇诺 → 只剩带该基因的个体
  await p.eval(`(() => {
    const m = ${lastModal()};
    const sel = m.querySelector('#h-gene');
    sel.value = '${growthSetup.cap}';
    sel.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 350);
  const geneFiltered = await p.eval(`(() => {
    const m = ${lastModal()};
    const cells = [...m.querySelectorAll('.growth-cell')];
    return { n: cells.length, names: cells.map((c) => c.textContent) };
  })()`);
  ok('基因筛选后只剩带该基因的个体',
    geneFiltered.n === 1 && geneFiltered.names[0].includes('V20成长甲'),
    JSON.stringify(geneFiltered));
  // 选个体 → 历史列表（倒序 2 条）
  await p.eval(`(() => { const c = ${lastModal()}.querySelector('.growth-cell'); if (c) c.click(); })()`, { awaitPromise: false });
  await wait(p, 350);
  const histList = await p.eval(`(() => {
    const m = ${lastModal()};
    const rows = [...m.querySelectorAll('#h-history .row')];
    return {
      n: rows.length,
      titles: rows.map((r) => r.querySelector('.row-title').textContent),
      hasAdd: !!m.querySelector('#h-history #h-add'),
      sub0: rows[0] ? rows[0].querySelector('.row-sub').textContent : '',
    };
  })()`);
  ok('选中个体展示历史测量记录（含添加按钮）',
    histList.n === 2 && histList.titles[0].includes('2026-10-01') && histList.hasAdd && histList.sub0.includes('41'),
    JSON.stringify(histList));
  // 添加记录（补录历史日期）
  await p.eval(`${lastModal()}.querySelector('#h-history #h-add').click()`, { awaitPromise: false });
  await wait(p, 400);
  await p.eval(`(() => {
    const m = ${lastModal()};
    m.querySelector('#h-date').value = '2026-08-20';
    m.querySelector('#h-time').value = '09:30';
    m.querySelector('#h-weight').value = '35.5';
    m.querySelector('#h-length').value = '16';
  })()`, { awaitPromise: false });
  await p.eval(`(() => { const b = [...${lastModal()}.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '保存'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 500);
  const afterAdd = await p.eval(`(() => {
    const m = ${lastModal()};
    const rows = [...m.querySelectorAll('#h-history .row')];
    return { n: rows.length, first: rows[0] ? rows[0].querySelector('.row-title').textContent : '' };
  })()`);
  ok('历史记录可新增（补录 2026-08-20，按时间倒序排第 3 位）',
    afterAdd.n === 3 && afterAdd.first.includes('2026-10-01'),
    JSON.stringify(afterAdd));
  // 编辑 2026-08-20 那条记录
  await p.eval(`(() => { const row = [...${lastModal()}.querySelectorAll('#h-history .row')].find((r) => r.textContent.includes('2026-08-20')); const b = row.querySelector('[data-hedit]'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 400);
  await p.eval(`(() => { const m = ${lastModal()}; m.querySelector('#h-weight').value = '36.2'; })()`, { awaitPromise: false });
  await p.eval(`(() => { const b = [...${lastModal()}.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '保存'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 500);
  const afterEdit = await p.eval(`(() => {
    const m = ${lastModal()};
    const row = [...m.querySelectorAll('#h-history .row')].find((r) => r.textContent.includes('2026-08-20'));
    return row ? row.querySelector('.row-sub').textContent : '';
  })()`);
  ok('历史记录可编辑（体重改为 36.2）', afterEdit.includes('36.2'), afterEdit);
  // 删除该记录
  await p.eval(`(() => { const row = [...${lastModal()}.querySelectorAll('#h-history .row')].find((r) => r.textContent.includes('2026-08-20')); const b = row.querySelector('[data-hdel]'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 400);
  await p.eval(`(() => { const b = [...${lastModal()}.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '删除'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 500);
  const afterDelete = await p.eval(`(() => {
    const m = ${lastModal()};
    const rows = [...m.querySelectorAll('#h-history .row')];
    return { n: rows.length, hasAug: rows.some((r) => r.textContent.includes('2026-08-20')) };
  })()`);
  ok('历史记录可删除', afterDelete.n === 2 && !afterDelete.hasAug, JSON.stringify(afterDelete));
  // 关闭弹窗 → 主页面选中该个体后曲线刷新（删除后剩 2 条测量：09-01 / 10-01）
  await p.eval(`(() => { const b = [...${lastModal()}.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 600);
  await p.eval(`(() => { const c = [...document.querySelectorAll('.growth-cell')].find((x) => x.textContent.includes('V20成长甲')); if (c) c.click(); })()`, { awaitPromise: false });
  await wait(p, 500);
  const trendAfter = await p.eval(`document.getElementById('view').textContent.includes('2 个记录点')`);
  ok('关闭历史弹窗后主页面成长曲线同步刷新', trendAfter, '');

  /* ===== F. 基因预测：类别筛选 + 显现概率 + 复合基因推导 ===== */
  const geneIds = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const byName = (n) => (s.listGenes('sp-crested').find((g) => g.name === n) || {}).id || '';
    return { cap: byName('卡布奇诺'), lw: byName('莉莉白'), ax: byName('缺黄'), legacy: byName('旧多基因${T}') };
  })()`, { awaitPromise: true });

  await p.goto(BASE + '#/predict', 1200);
  // v3.5：基因类别筛选已移入下拉弹层内（select[multiple] 的 data-pk-filters），页面不再外置 .gene-type-seg
  const catSeg = await p.eval(`(() => {
    const segs = [...document.querySelectorAll('.gene-type-seg')];
    const sel = document.querySelector('#male-box .g-sel');
    let filters = [];
    try { filters = sel && sel.dataset.pkFilters ? JSON.parse(sel.dataset.pkFilters) : []; } catch (e) {}
    return {
      n: segs.length,
      items: segs[0] ? [...segs[0].querySelectorAll('.seg-item')].map((x) => x.textContent) : [],
      multiple: !!sel && sel.multiple,
      filterLabels: filters.map((f) => f.l),
    };
  })()`);
  ok('v3.5 预测页类别筛选已移入基因下拉内（页面无外置筛选条）',
    catSeg.n === 0 && catSeg.multiple === true, JSON.stringify(catSeg));
  ok('下拉内筛选项为 全部/显性/隐性/杂合/不完全显性/复合',
    ['全部', '显性', '隐性', '杂合', '不完全显性', '复合'].every((t) => catSeg.filterLabels.includes(t)),
    JSON.stringify(catSeg.filterLabels));
  // 打开下拉 → 选「复合」→ 列表只出复合基因
  await p.eval(`document.querySelector('#male-box .pk-btn').click()`, { awaitPromise: false });
  await wait(p, 350);
  await p.eval(`(() => { const it = [...document.querySelectorAll('.modal .pk-chip')].find((x) => x.textContent.trim() === '复合'); if (it) it.click(); })()`, { awaitPromise: false });
  await wait(p, 300);
  const comboOpts = await p.eval(`[...document.querySelectorAll('.modal .pk-opt')].filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.pk-opt-txt').textContent)`);
  ok('在下拉内按「复合」类别筛选后列表只含复合基因',
    comboOpts.length >= 3 && comboOpts.every((t) => t.includes('复合')) && comboOpts.some((t) => t.includes('法布奇诺')),
    JSON.stringify(comboOpts));
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await wait(p, 250);
  const pickGene = async (side, geneId) => {
    // v3.5：基因下拉为多选框 —— 需设置 option.selected（sel.value 对 multiple 无效）
    // 本辅助函数保持旧的「替换」语义（先清空该侧已选，再选目标）
    await p.eval(`(() => {
      const box = document.getElementById('${side}-box');
      const sel = box.querySelector('.g-sel');
      [...sel.options].forEach((o) => { o.selected = false; });
      const opt = [...sel.options].find((o) => o.value === '${geneId}');
      if (opt) { opt.selected = true; }
      sel.dispatchEvent(new Event('change'));
    })()`, { awaitPromise: false });
    await wait(p, 250);
  };
  await pickGene('male', geneIds.cap);
  await pickGene('female', geneIds.lw);
  // v3.5：每方 1 个下拉框（可多选基因），选中数量为 1
  const singleGene = await p.eval(`(() => ({
    male: document.querySelectorAll('#male-box .g-sel').length,
    female: document.querySelectorAll('#female-box .g-sel').length,
    maleSel: document.querySelector('#male-box .g-sel').selectedOptions.length,
    femaleSel: document.querySelector('#female-box .g-sel').selectedOptions.length,
  }))()`);
  ok('基因预测每方 1 个基因下拉（多选框，当前各选 1 项）',
    singleGene.male === 1 && singleGene.female === 1 && singleGene.maleSel === 1 && singleGene.femaleSel === 1,
    JSON.stringify(singleGene));
  // v2.2：开始预测 → 弹窗三列结果（概率 / 基因性状 / 基因名称）
  const readModal = () => p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      ths: [...m.querySelectorAll('.gp-table th')].map((x) => x.textContent),
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
      hasImg: !!m.querySelector('#gp-img'),
      txt: m.textContent,
    };
  })()`);
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await wait(p, 700);
  const modal1 = await readModal();
  ok('预测结果弹窗为三列（概率/基因性状/基因名称）且含导出图片',
    modal1 && modal1.ths.length === 3 && modal1.ths[0] === '概率' && modal1.ths[1] === '基因性状' && modal1.ths[2] === '基因名称' && modal1.hasImg,
    JSON.stringify(modal1 && modal1.ths));
  ok('复合基因「法布奇诺」行出现且概率 25%（50%×50%）',
    modal1 && modal1.rows.some((r) => r[0] === '25%' && r[1] === '卡布奇诺+莉莉白' && r[2].startsWith('法布奇诺')),
    JSON.stringify(modal1 && modal1.rows));
  ok('结果含卡布奇诺 / 莉莉白 / 原色各行',
    modal1 && modal1.rows.some((r) => r[1] === '卡布奇诺') && modal1.rows.some((r) => r[1] === '莉莉白') && modal1.rows.some((r) => r[1] === '原色'),
    JSON.stringify(modal1 && modal1.rows));
  ok('预测池不含存量多基因基因', modal1 && !modal1.txt.includes('旧多基因${T}'), '');
  // 关闭弹窗再跑下一轮（弹窗为堆叠式，不关会读到旧结果）
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await wait(p, 250);

  // 超级体风险：公母均选莉莉白（单拷贝×单拷贝 → 25% 超级莉莉白）→ 警告 + 超级命名
  await pickGene('male', geneIds.lw);
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await wait(p, 700);
  const modal2 = await readModal();
  ok('不完全显性超级体风险警告仍在', modal2 && modal2.txt.includes('超级体'), '');
  ok('莉莉白×莉莉白 → 50% 莉莉白 / 25% 超级莉莉白（性状记为 莉莉白+莉莉白 表达式） / 25% 原色',
    modal2 && modal2.rows.some((r) => r[0] === '50%' && r[1] === '莉莉白')
      && modal2.rows.some((r) => r[0] === '25%' && r[1] === '莉莉白+莉莉白' && r[2] === '超级莉莉白')
      && modal2.rows.some((r) => r[0] === '25%' && r[1] === '原色'),
    JSON.stringify(modal2 && modal2.rows));
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await wait(p, 250);

  // 组分不全（母方置空）→ 不出现法布奇诺
  await p.eval(`(() => {
    const sel = document.querySelector('#female-box .g-sel');
    if (sel) { [...sel.options].forEach((o) => { o.selected = false; }); sel.dispatchEvent(new Event('change')); }
  })()`, { awaitPromise: false });
  await wait(p, 300);
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await wait(p, 700);
  const modal3 = await readModal();
  ok('组分不全时不推导复合基因', modal3 && !modal3.txt.includes('法布奇诺'), '');
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await wait(p, 250);

  /* ===== F2. 蛋详情基因预测：复合基因推导 ===== */
  const eggPred = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const g = await import('./js/genetics.js');
    const cap = s.listGenes('sp-crested').find((x) => x.name === '卡布奇诺');
    const lw = s.listGenes('sp-crested').find((x) => x.name === '莉莉白');
    const mother = await s.createAnimal({ name: 'V20蛋母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [cap.id], geneState: 'v' });
    const father = await s.createAnimal({ name: 'V20蛋父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [lw.id], geneState: 'h' });
    const egg = await s.createEgg({ motherId: mother.id, fatherId: father.id, speciesId: 'sp-crested', status: 'fertile', layDate: '2026-10-05', expectHatchDate: '2026-12-14' });
    // 引擎层：deriveCombos 直接验证
    const speciesGenes = s.listGenes('sp-crested');
    const derived = g.deriveCombos(
      [
        { name: '卡布奇诺', type: 'dominant', male: 'v', female: 'n', dist: g.geneOutcome('dominant', 'v', 'n') },
        { name: '莉莉白', type: 'incomplete', male: 'n', female: 'h', dist: g.geneOutcome('incomplete', 'n', 'h') },
      ],
      speciesGenes,
    );
    const frap = derived.find((d) => d.gene.name === '法布奇诺');
    return { eggId: egg.id, derivedProb: frap ? Math.round(frap.prob * 100) : -1, comps: frap ? frap.comps.join('+') : '' };
  })()`, { awaitPromise: true });
  ok('引擎：法布奇诺组分=卡布奇诺+莉莉白，推导概率 25%（50%×50%）',
    eggPred.derivedProb === 25 && eggPred.comps === '卡布奇诺+莉莉白',
    JSON.stringify(eggPred));
  // 孟德尔表对称性：公母状态反序时结果一致（修复反序 fallback  bug）
  const sym = await p.eval(`(async () => {
    const g = await import('./js/genetics.js');
    const pct = (d) => d.map(([l, p]) => l + ':' + Math.round(p * 100)).sort().join('|');
    return {
      reNH: pct(g.geneOutcome('recessive', 'n', 'h')),
      inNH: pct(g.geneOutcome('incomplete', 'n', 'h')),
      doNV: pct(g.geneOutcome('dominant', 'n', 'v')),
    };
  })()`, { awaitPromise: true });
  ok('孟德尔引擎对称性（反序 n×h → 50/50、n×v → 50%表现）',
    sym.reNH === 'h:50|n:50' && sym.inNH === 'h:50|n:50' && sym.doNV === 'n:50|v:50',
    JSON.stringify(sym));
  await p.goto(BASE + '#/egg/' + eggPred.eggId, 1200);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 600);
  const eggPredUi = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const rows = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { rows, hasFrap: rows.some((r) => r[2].startsWith('法布奇诺')), has25: rows.some((r) => r[0] === '25%') };
  })()`);
  ok('蛋详情基因预测展示法布奇诺行（25%）',
    eggPredUi && eggPredUi.hasFrap && eggPredUi.has25, JSON.stringify(eggPredUi && eggPredUi.rows));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].pop(); if (b) b.click(); })()`, { awaitPromise: false });

  /* ===== 汇总 ===== */
  const pass = R.filter(([, c]) => c).length;
  console.log(`\\n===== v2.0 验证结果：${pass}/${R.length} 通过 =====`);
  const fails = R.filter(([, c]) => !c);
  if (fails.length) { console.log('失败项：'); fails.forEach(([n]) => console.log('  ❌ ' + n)); process.exitCode = 1; }
  console.log('CONSOLE-ERRORS:', JSON.stringify(p.consoleErrors));
});
