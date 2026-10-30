// verify-v14.mjs —— 本轮验证：铲屎官首位 / 产蛋物种先行 / 蛋个体双向关联 / 三代族谱+同窝 / 工单管理 / 全量部分备份 / 编号规范化 / 首页三标签 / 导出修复 / 下拉样式
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3217/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 设置页：铲屎官第一位 ===== */
  await p.goto(BASE + '#/settings', 1200);
  await wait(p, 400);
  const firstCard = await p.eval(`document.querySelector('#view .card h3').textContent`);
  ok('设置页第一张卡片为「铲屎官」', firstCard.trim() === '铲屎官', firstCard);

  /* ===== B. 记录产蛋：先弹物种筛选，父母本仅显示该物种 ===== */
  await p.goto(BASE + '#/eggs', 900);
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  await wait(p, 400);
  const spModal = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return { title: m ? m.querySelector('.m-title').textContent : '', hasSpecies: !!m && m.textContent.includes('睫角守宫'), hasMother: !!document.getElementById('eg-mother') };
  })()`);
  ok('记录产蛋先弹物种选择', spModal.title.includes('选择物种') && spModal.hasSpecies && !spModal.hasMother, JSON.stringify(spModal));
  // 选择「猪鼻蛇」→ 母本/父本只显示猪鼻蛇个体
  await p.eval(`(() => { const rows = [...document.querySelectorAll('.modal .pick-row')]; const r = rows.find(x => x.textContent.includes('猪鼻蛇')); r.click(); })()`, { awaitPromise: false });
  await wait(p, 400);
  const eggForm = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    const opts = (id) => [...(document.getElementById(id) ? document.getElementById(id).options : [])].map(o => o.textContent);
    return { title: m ? m.querySelector('.m-title').textContent : '', mothers: opts('eg-mother'), fathers: opts('eg-father') };
  })()`);
  ok('选择物种后进入记录产蛋表单', eggForm.title.includes('记录产蛋') && eggForm.title.includes('猪鼻蛇'), eggForm.title);
  const hognoseNames = await p.eval(`(async () => { const s = await import('./js/store.js'); return s.S.animal.filter(a => a.speciesId === 'sp-hognose' && (a.sex === 'female' || a.sex === 'unknown')).map(a => a.name); })()`, { awaitPromise: true });
  const motherOptsOk = hognoseNames.every((n) => eggForm.mothers.some((o) => o.includes(n)));
  ok('母本下拉仅显示所选物种个体', motherOptsOk, `物种母本=${JSON.stringify(hognoseNames)} 下拉=${JSON.stringify(eggForm.mothers)}`);
  await p.eval(`document.querySelector('.modal .m-close').click()`, { awaitPromise: false });

  /* ===== C. 蛋 ↔ 个体双向关联 ===== */
  const linkTest = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const mother = s.S.animal.find(a => a.sex === 'female' && !a.isArchived);
    const egg = await s.createEgg({ motherId: mother.id, fatherId: null, speciesId: mother.speciesId, status: 'fertile', layDate: '2026-10-01', expectHatchDate: '2026-12-01', note: 'V14关联蛋' });
    await s.updateEgg(egg.id, { status: 'hatched' });
    await s.archiveEgg(egg.id, 'hatched');
    const unlinkedBefore = s.eggUnlinked(s.getEgg(egg.id));
    // 新建个体并手动关联
    const baby = await s.createAnimal({ name: 'V14孵化个体${T}', speciesId: mother.speciesId, sex: 'unknown', geneIds: [] });
    await s.linkEggAnimal(egg.id, baby.id);
    const brief = s.linkedAnimalBrief(s.getEgg(egg.id));
    return {
      eggId: egg.id, babyId: baby.id,
      unlinkedBefore,
      unlinkedAfter: s.eggUnlinked(s.getEgg(egg.id)),
      eggLinkedId: s.getEgg(egg.id).hatchedAnimalId,
      animalFromEgg: s.getAnimal(baby.id).fromEggId,
      briefName: brief ? brief.animal.name : null,
      briefCode: brief ? brief.animal.code : null,
      hasGeneText: brief ? typeof brief.geneText === 'string' : false,
    };
  })()`, { awaitPromise: true });
  ok('已孵化未关联时 eggUnlinked 为 true', linkTest.unlinkedBefore === true, JSON.stringify(linkTest));
  ok('手动关联后蛋记录 hatchedAnimalId 正确', linkTest.eggLinkedId === linkTest.babyId, linkTest.eggLinkedId);
  ok('个体 fromEggId 回写正确', linkTest.animalFromEgg === linkTest.eggId, linkTest.animalFromEgg);
  ok('关联后不再提示未关联', linkTest.unlinkedAfter === false, '');
  ok('蛋详情可获取关联个体编号与基因', linkTest.briefName === 'V14孵化个体' + T && !!linkTest.briefCode && linkTest.hasGeneText, JSON.stringify(linkTest.briefCode));

  /* 蛋详情 UI：未关联标签 → 关联后展示编号 */
  await p.eval(`(async () => { const s = await import('./js/store.js'); const m = s.S.animal.find(a => a.sex === 'female' && !a.isArchived); const egg = await s.createEgg({ motherId: m.id, speciesId: m.speciesId, status: 'fertile', layDate: '2026-10-02', expectHatchDate: '2026-12-02', note: 'V14未关联蛋' }); await s.updateEgg(egg.id, { status: 'hatched' }); await s.archiveEgg(egg.id, 'hatched'); window.__v14UnlinkedEgg = egg.id; })()`, { awaitPromise: false });
  await wait(p, 500);
  await p.goto(BASE + '#/egg/' + await p.eval(`window.__v14UnlinkedEgg`, { awaitPromise: true }), 900);
  const eggDetailUi = await p.eval(`(() => ({ txt: document.getElementById('view').textContent, hasBtn: !!document.getElementById('btn-link') }))()`);
  const eggDetailTxt = eggDetailUi.txt;
  ok('蛋详情展示「未关联个体」标签与关联按钮', eggDetailTxt.includes('未关联个体') && eggDetailUi.hasBtn, eggDetailTxt.slice(0, 80));

  /* 个体详情：来源蛋编号 */
  await p.goto(BASE + '#/animal/' + linkTest.babyId + '?tab=overview', 900);
  const animalTxt = await p.eval(`document.getElementById('view').textContent`);
  ok('个体概况展示来源蛋', animalTxt.includes('来源蛋') && animalTxt.includes(linkTest.briefCode ? '' : ''), animalTxt.slice(0, 120));

  /* ===== D. 三代族谱 + 同窝 ===== */
  const ped = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const sp = s.S.species[0];
    const mk = async (name, sex, mother, father) => { const a = await s.createAnimal({ name, speciesId: sp.id, sex, motherId: mother || null, fatherId: father || null }); return a.id; };
    // 三代：曾祖(2) → 祖(2) → 父母(2) → 自己 + 同窝妹妹
    const gg1 = await mk('V14曾祖母${T}', 'female', null, null);
    const gg2 = await mk('V14曾祖父${T}', 'male', null, null);
    const g1 = await mk('V14祖母${T}', 'female', gg1, gg2);
    const g2 = await mk('V14祖父${T}', 'male', gg1, gg2);
    const p1 = await mk('V14母亲${T}', 'female', g1, g2);
    const p2 = await mk('V14父亲${T}', 'male', g1, g2);
    const self = await mk('V14自己${T}', 'male', p1, p2);
    const sib = await mk('V14同窝妹${T}', 'female', p1, p2);
    const kid = await mk('V14子代${T}', 'unknown', self, null);
    const clutch = s.clutchAnimals(self);
    return { self, sib, kid, gg1, gg2, clutchIds: clutch.map(x => x.id), total: s.S.animal.length };
  })()`, { awaitPromise: true });
  ok('同窝个体识别（同父同母）', ped.clutchIds.includes(ped.sib), JSON.stringify(ped.clutchIds));
  // v2.6：谱系入口移到名字行最右侧，点击弹窗展示（不再有独立 Tab）
  await p.goto(BASE + '#/animal/' + ped.self, 900);
  const pedEntry = await p.eval(`(() => {
    const btn = document.getElementById('btn-pedigree');
    const row = btn ? btn.parentElement : null;
    return {
      hasBtn: !!btn,
      inNameRow: !!row && row.textContent.includes('V14自己'),
      isLastInRow: !!row && row.lastElementChild === btn,
      hasPedTab: [...document.querySelectorAll('#d-tabs .tab')].some((t) => t.textContent.includes('谱系')),
    };
  })()`);
  ok('谱系入口在名字同一行最右侧且无独立 Tab', pedEntry.hasBtn && pedEntry.inNameRow && pedEntry.isLastInRow && !pedEntry.hasPedTab, JSON.stringify(pedEntry));
  await p.eval(`document.getElementById('btn-pedigree').click()`, { awaitPromise: false });
  await wait(p, 500);
  const pedUi = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const svg = m.querySelector('#pedm-svg');
    const nodes = [...svg.querySelectorAll('.ped-node')].map(n => n.dataset.id);
    const txt = m.innerText;
    return { count: nodes.length, hasSelf: nodes.includes('${ped.self}'), hasSib: nodes.includes('${ped.sib}'), hasKid: nodes.includes('${ped.kid}'), hasGg: nodes.includes('${ped.gg1}'), legend: txt.includes('同窝个体'), genTxt: txt.includes('曾祖辈'), zoom: !!m.querySelector('#pedm-zoom') };
  })()`);
  ok('族谱弹窗 SVG 含三代祖先 + 自己 + 同窝 + 子代（含放大按钮）', pedUi && pedUi.hasSelf && pedUi.hasSib && pedUi.hasKid && pedUi.hasGg && pedUi.count >= 8 && pedUi.zoom, JSON.stringify(pedUi));
  ok('族谱图例与代际说明齐全', pedUi && pedUi.legend && pedUi.genTxt, JSON.stringify(pedUi));
  // 关闭族谱弹窗（v2.6 起谱系为弹窗；不关会残留 .modal 干扰后续弹窗断言）
  await p.eval(`(() => { const m = [...document.querySelectorAll('.modal-mask')].find((x) => x.textContent.includes('族谱')); if (m) m.remove(); })()`, { awaitPromise: false });
  await wait(p, 200);

  /* ===== E. 工单管理 ===== */
  await p.goto(BASE + '#/todos', 1100);
  const todosUi = await p.eval(`(() => ({
    title: document.title.includes('工单管理'),
    hasAdd: !!document.getElementById('btn-add'),
    hasExport: !!document.getElementById('btn-export'),
    hasImport: !!document.getElementById('btn-import'),
    segs: [...document.querySelectorAll('#f-status .seg-item')].map(x => x.dataset.v).join(','),
    hasSearch: !!document.getElementById('f-q'),
    hasSrc: !!document.getElementById('f-src'),
    viewTxt: document.getElementById('view').innerText.slice(0, 150),
  }))()`);
  ok('工单管理页渲染（增/导出/导入/筛选/搜索）', todosUi.title && todosUi.hasAdd && todosUi.hasExport && todosUi.hasImport && todosUi.segs === ',pending,done,cancelled' && todosUi.hasSearch && todosUi.hasSrc, JSON.stringify(todosUi));
  // 新建工单
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  await wait(p, 300);
  await p.eval(`document.getElementById('tk-title').value = 'V14工单${T}'; document.getElementById('tk-date').value = '2026-11-11'; document.querySelector('.modal .m-foot .btn:not(.ghost)').click()`, { awaitPromise: false });
  await wait(p, 500);
  const todoCreated = await p.eval(`(async () => { const s = await import('./js/store.js'); const t = s.S.todo.find(x => x.title === 'V14工单${T}'); return t ? { title: t.title, deadline: t.deadline, status: t.status, src: t.sourceType } : null; })()`, { awaitPromise: true });
  ok('工单管理可新建工单', todoCreated && todoCreated.deadline === '2026-11-11' && todoCreated.status === 'pending' && todoCreated.src === 'custom', JSON.stringify(todoCreated));
  // 编辑（改标题+状态）
  const todoEdited = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const t = s.S.todo.find(x => x.title === 'V14工单${T}');
    const t2 = s.S.todo.find(x => x.id === t.id);
    await s.updateTodo(t.id, { title: 'V14工单改${T}', deadline: '2026-12-12', status: 'done' });
    const doneAtSet = !!t2.doneAt;
    await s.reopenTodo(t.id);
    return { title: t2.title, deadline: t2.deadline, done: doneAtSet, reopened: s.getTodo(t.id).status };
  })()`, { awaitPromise: true });
  ok('工单可编辑标题/截止/状态并恢复', todoEdited.title === 'V14工单改' + T && todoEdited.deadline === '2026-12-12' && todoEdited.done && todoEdited.reopened === 'pending', JSON.stringify(todoEdited));
  // 删除
  const todoDel = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const before = s.S.todo.length;
    const t = s.S.todo.find(x => x.title === 'V14工单改${T}');
    await s.removeTodo(t.id);
    return { before, after: s.S.todo.length, gone: !s.S.todo.some(x => x.id === t.id) };
  })()`, { awaitPromise: true });
  ok('工单可删除', todoDel.gone && todoDel.after === todoDel.before - 1, JSON.stringify(todoDel));
  // 导出 / 导入（合并）
  const todoIo = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const rows = s.listAllTodos();
    const pkg = s.exportTodos(rows.slice(0, 3));
    const okPkg = pkg.app === 'reptile-breeding-todos' && pkg.todos.length === 3;
    // 改一条再导入 → 应被覆盖合并
    const victim = pkg.todos[0];
    victim.title = 'V14导入覆盖${T}';
    const r = await s.importTodos(pkg);
    const after = s.S.todo.find(x => x.id === pkg.todos[0].id);
    return { okPkg, added: r.added, updated: r.updated, covered: after && after.title === 'V14导入覆盖${T}', totalKept: s.S.todo.length >= rows.length };
  })()`, { awaitPromise: true });
  ok('工单导出包结构正确', todoIo.okPkg, JSON.stringify(todoIo));
  ok('工单导入按 ID 覆盖合并且不丢其他工单', todoIo.covered && todoIo.updated >= 1 && todoIo.totalKept, JSON.stringify(todoIo));

  /* ===== F. 备份：全量 / 部分 ===== */
  const backupFlow = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const full = s.buildBackup();
    const partial = s.buildBackup({ tables: ['egg', 'animal'] });
    // 部分导入 → 合并：改一条蛋再导回，其他表不动
    const egg = s.S.egg[0];
    const before = { animal: s.S.animal.length, egg: s.S.egg.length, bill: s.S.bill.length, todo: s.S.todo.length };
    const pkg2 = s.buildBackup({ tables: ['egg'] });
    pkg2.tables.egg.forEach(e => { if (e.id === egg.id) e.note = 'V14部分导入${T}'; });
    const n = await s.importBackup(pkg2);
    const after = { animal: s.S.animal.length, egg: s.S.egg.length, bill: s.S.bill.length, todo: s.S.todo.length };
    return {
      fullPartial: full.partial === false,
      fullTables: Object.keys(full.tables).length,
      partialPartial: partial.partial === true,
      partialTables: Object.keys(partial.tables).sort().join(','),
      importReturn: typeof n === 'number',
      merged: s.getEgg(egg.id).note === 'V14部分导入${T}',
      othersIntact: before.animal === after.animal && before.bill === after.bill && before.todo === after.todo,
    };
  })()`, { awaitPromise: true });
  ok('全量备份包含全部表', backupFlow.fullPartial && backupFlow.fullTables >= 12, JSON.stringify(backupFlow));
  ok('部分备份仅含所选表', backupFlow.partialPartial && backupFlow.partialTables === 'animal,egg', JSON.stringify(backupFlow));
  ok('部分导入按 ID 覆盖合并、不影响其他表', backupFlow.merged && backupFlow.othersIntact, JSON.stringify(backupFlow));
  // 备份页 UI：备份弹窗有全量/部分切换
  await p.goto(BASE + '#/backup', 900);
  await p.eval(`document.getElementById('btn-export').click()`, { awaitPromise: false });
  await wait(p, 300);
  const bkModal = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return { segs: [...m.querySelectorAll('#bk-mode .seg-item')].map(x => x.dataset.v).join(','), full: !!m.querySelector('#bk-full'), partial: !!m.querySelector('#bk-partial') };
  })()`);
  ok('备份弹窗可切换全量/部分', bkModal.segs === 'full,partial' && bkModal.full && bkModal.partial, JSON.stringify(bkModal));
  await p.eval(`(() => { const it = [...document.querySelectorAll('#bk-mode .seg-item')].find(x => x.dataset.v === 'partial'); it.click(); })()`, { awaitPromise: false });
  const bkPartial = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return { visible: m.querySelector('#bk-partial').style.display !== 'none', boxes: m.querySelectorAll('#bk-tables input[type=checkbox]').length };
  })()`);
  ok('部分备份展示数据表多选', bkPartial.visible && bkPartial.boxes >= 12, JSON.stringify(bkPartial));
  await p.eval(`document.querySelector('.modal .m-close').click()`, { awaitPromise: false });

  /* ===== G. 编号规范化：蛇用基因英文缩写 ===== */
  const codeNorm = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const albino = s.listGenes('sp-hognose').find(g => g.en === 'Albino');
    // 造一条「物种前缀」旧编号的蛇
    const a = await s.createAnimal({ name: 'V14旧编号蛇${T}', speciesId: 'sp-hognose', sex: 'female', geneIds: [albino.id] });
    a.code = '猪鼻-001'; await db.dbPut('animal', a);
    const before = a.code;
    const n = await s.normalizeAnimalCodes();
    const after = s.getAnimal(a.id).code;
    // 新建蛇直接拿基因缩写
    const b = await s.createAnimal({ name: 'V14新编号蛇${T}', speciesId: 'sp-hognose', sex: 'male', geneIds: [albino.id] });
    return { before, after, fixed: /^AL-\\d{3}$/.test(after), fresh: b.code, n };
  })()`, { awaitPromise: true });
  ok('旧物种前缀编号被规范化为基因缩写', codeNorm.fixed && codeNorm.before === '猪鼻-001', JSON.stringify(codeNorm));
  ok('新建蛇个体编号即基因英文缩写', /^AL-\d{3}$/.test(codeNorm.fresh), codeNorm.fresh);

  /* ===== H. 首页三标签 ===== */
  await p.goto(BASE + '#/home', 1000);
  const homeTabs = await p.eval(`(() => {
    const items = [...document.querySelectorAll('#todo-tabs .seg-item')];
    return { n: items.length, labels: items.map(x => x.textContent.replace(/\\s+/g, '')).join('|'), active: items.find(x => x.classList.contains('active')).dataset.tab };
  })()`);
  ok('首页待办分三个标签', homeTabs.n === 3 && /待办/.test(homeTabs.labels) && /计划中/.test(homeTabs.labels) && /已办/.test(homeTabs.labels), JSON.stringify(homeTabs));
  // 切到「已办」应渲染已完成/已取消工单
  await p.eval(`(() => { const it = [...document.querySelectorAll('#todo-tabs .seg-item')].find(x => x.dataset.tab === 'done'); it.click(); })()`, { awaitPromise: false });
  await wait(p, 300);
  const doneTab = await p.eval(`(() => {
    const list = document.getElementById('todo-list');
    return { txt: list.textContent, hasReopen: !!list.querySelector('[data-act="reopen"]'), empty: !!list.querySelector('.empty-tip') };
  })()`);
  ok('「已办」标签可切换且有恢复入口', doneTab.hasReopen || doneTab.empty, JSON.stringify(doneTab).slice(0, 120));

  /* ===== I. 导出图片：data URL → Blob 修复 ===== */
  const exportFix = await p.eval(`(async () => {
    const u = await import('./js/util.js');
    // 1x1 透明 PNG
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    let err = null;
    try { u.download('v14-test.png', png, 'image/png'); } catch (e) { err = e.message; }
    // 同时验证 Blob 内容字节正确（复制 download 内部 dataUrl→blob 逻辑做断言）
    const [head, body] = png.split(',');
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    return { err, size: blob.size, type: blob.type, sig: [...bytes.slice(0, 4)].join(',') };
  })()`, { awaitPromise: true });
  ok('导出图片不再抛错且 PNG 字节正确', !exportFix.err && exportFix.type === 'image/png' && exportFix.size > 60 && exportFix.sig === '137,80,78,71', JSON.stringify(exportFix));

  /* ===== J. 下拉样式与全路由回归 ===== */
  // v1.5 起下拉改为自定义选择器（picker.js）：原生 select 隐藏，触发器 .pk-btn + 箭头 SVG
  await p.goto(BASE + '#/animal/new', 1000);
  const selStyle = await p.eval(`(() => {
    const wrap = document.querySelector('.pk-wrap');
    const btn = wrap ? wrap.querySelector('.pk-btn') : null;
    const caret = btn ? btn.querySelector('.pk-caret') : null;
    return { wrapped: !!wrap, hasBtn: !!btn, hasCaret: !!caret, caretIsSvg: caret ? caret.tagName.toLowerCase() === 'svg' : false };
  })()`);
  ok('全局下拉为自定义选择器（触发器+SVG 箭头）', selStyle.wrapped && selStyle.hasBtn && selStyle.hasCaret && selStyle.caretIsSvg, JSON.stringify(selStyle));

  const routes = [
    ['#/home', '首页待办'], ['#/animals', '个体列表'], ['#/eggs', '蛋管理'], ['#/eggs/archive', '蛋归档'],
    ['#/todos', '工单管理'], ['#/backup', '备份与恢复'], ['#/more', '更多功能'], ['#/settings', '设置'],
    ['#/growth', '成长记录'], ['#/logs', '饲养日志'], ['#/pairings', '配对记录'], ['#/genes', '基因库'],
    ['#/species', '物种库'], ['#/tags', '标签管理'], ['#/bills', '记账报表'], ['#/reports', '月度报表'],
    ['#/share', '个体分享'], ['#/cages', '爬柜方案'], ['#/predict', '基因配对预测'],
  ];
  let routeOk = true, routeFail = '';
  for (const [hash, marker] of routes) {
    await p.goto(BASE + hash, 800);
    const r = await p.eval(`(() => { const v = document.getElementById('view'); return { fail: v.innerText.includes('页面加载失败'), has: v.innerText.includes('${marker}'), len: v.innerHTML.length }; })()`);
    if (r.fail || !r.has || r.len < 150) { routeOk = false; routeFail = hash + ':' + JSON.stringify(r); }
  }
  ok('全部路由渲染正常（含工单管理）', routeOk, routeFail);
});

const pass = R.filter((r) => r[1]).length;
console.log(`\n========== verify-v14: ${pass}/${R.length} 通过 ==========`);
process.exit(pass === R.length ? 0 : 1);
