// verify-v19.mjs —— 本轮验证：基因库按类型筛选 / 父母本编号+基因展示 / 蛋详情编辑 /
// 莉莉白改为不完全显性 / 蛋基因预测按父母本基因 / 爬柜清理周期待办同步
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3223/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const lastModal = () => `[...document.querySelectorAll('.modal')].pop()`;
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 莉莉白改为不完全显性 ===== */
  const lilly = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const g = s.listGenes('sp-crested').find((x) => x.name === '莉莉白');
    return { type: g && g.type, id: g && g.id };
  })()`, { awaitPromise: true });
  ok('莉莉白基因类型为不完全显性（incomplete）', lilly.type === 'incomplete', JSON.stringify(lilly));

  /* ===== B. 基因库按遗传类型筛选 ===== */
  await p.goto(BASE + '#/genes', 1200);
  const typeSeg = await p.eval(`(() => {
    const seg = document.getElementById('f-type');
    return {
      exists: !!seg,
      items: [...seg.querySelectorAll('.seg-item')].map((x) => x.textContent),
      active: (seg.querySelector('.seg-item.active') || {}).textContent,
    };
  })()`);
  // v3.5：新增「杂合」类型 → 筛选项 6 个
  ok('基因库页有类型筛选行（全部/显性/隐性/杂合/不完全显性/复合，v2.0 起无多基因选育）',
    typeSeg.exists && typeSeg.items.length === 6 && typeSeg.items[0] === '全部类型' && typeSeg.active === '全部类型'
    && typeSeg.items.includes('杂合'),
    JSON.stringify(typeSeg.items));

  const clickType = async (label) => {
    await p.eval(`(() => {
      const seg = document.getElementById('f-type');
      const it = [...seg.querySelectorAll('.seg-item')].find((x) => x.textContent === '${label}');
      if (it) it.click();
    })()`, { awaitPromise: false });
    await wait(p, 350);
    return p.eval(`(() => {
      const rows = [...document.querySelectorAll('#gene-tbl tbody tr')];
      return {
        types: rows.map((r) => ((r.children[1] || {}).textContent || '').trim()),
        names: rows.map((r) => ((r.children[0] || {}).textContent || '').trim()),
      };
    })()`);
  };

  const domRows = await clickType('显性');
  ok('筛选「显性」仅展示显性基因', domRows.types.length > 0 && domRows.types.every((t) => t === '显性'), JSON.stringify(domRows.types));

  const incRows = await clickType('不完全显性');
  ok('筛选「不完全显性」仅展示不完全显性基因（含莉莉白）',
    incRows.types.length > 0 && incRows.types.every((t) => t === '不完全显性') && incRows.names.some((n) => n.includes('莉莉白')),
    JSON.stringify(incRows.names));

  const comboRows = await clickType('复合');
  ok('筛选「复合」仅展示复合基因', comboRows.types.length > 0 && comboRows.types.every((t) => t === '复合'), JSON.stringify(comboRows.types));

  // 组合筛选：物种 + 类型
  await p.eval(`(() => {
    const seg = document.getElementById('f-species');
    const it = [...seg.querySelectorAll('.seg-item')].find((x) => x.textContent === '猪鼻蛇');
    if (it) it.click();
  })()`, { awaitPromise: false });
  await wait(p, 350);
  const comboHog = await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#gene-tbl tbody tr')];
    return {
      types: rows.map((r) => ((r.children[1] || {}).textContent || '').trim()),
      sp: rows.map((r) => ((r.children[2] || {}).textContent || '').trim()),
      names: rows.map((r) => ((r.children[0] || {}).textContent || '').trim()),
      empty: !!document.querySelector('#gene-tbl tbody .empty-tip'),
    };
  })()`);
  ok('物种+类型组合筛选（猪鼻蛇·复合，无复合基因时为空态且不串物种）',
    (comboHog.empty || (comboHog.sp.every((s) => s === '猪鼻蛇') && comboHog.types.every((t) => t === '复合')))
    && !comboHog.names.some((n) => n.includes('法布奇诺')),
    JSON.stringify(comboHog));

  /* ===== C. 父母本数据准备（编号 + 基因） ===== */
  const parents = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const ax = s.listGenes('sp-crested').find((g) => g.name === '缺黄');
    const lw = s.listGenes('sp-crested').find((g) => g.name === '莉莉白');
    const mother = await s.createAnimal({ name: 'V19母本${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [ax.id] });
    const father = await s.createAnimal({ name: 'V19父本${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [lw.id] });
    const egg = await s.createEgg({ motherId: mother.id, fatherId: father.id, speciesId: 'sp-crested', status: 'fertile', layDate: '2026-10-01', expectHatchDate: '2026-12-01' });
    return { motherId: mother.id, fatherId: father.id, mCode: mother.code, fCode: father.code, eggId: egg.id, mGene: s.animalGeneStateText(mother), fGene: s.animalGeneStateText(father) };
  })()`, { awaitPromise: true });
  ok('父母本身旁文本含基因（v2.6 起不再显示基因状态）', parents.mGene === '缺黄' && parents.fGene === '莉莉白', JSON.stringify({ m: parents.mGene, f: parents.fGene }));

  /* ===== D. 蛋管理列表：父母本显示编号+基因 ===== */
  await p.goto(BASE + '#/eggs', 1300);
  const eggCard = await p.eval(`(() => {
    const cards = [...document.querySelectorAll('.egg-card')];
    const c = cards.find((x) => x.textContent.includes('V19母本${T}'));
    return c ? c.querySelector('.eg-meta').textContent : '';
  })()`);
  ok('蛋列表母本行显示编号+基因',
    eggCard.includes(`V19母本${T}`) && eggCard.includes(parents.mCode) && eggCard.includes('· 缺黄'),
    eggCard.trim());
  ok('蛋列表父本行显示编号+基因',
    eggCard.includes(`V19父本${T}`) && eggCard.includes(parents.fCode) && eggCard.includes('· 莉莉白'),
    eggCard.trim());

  /* ===== E. 记录产蛋弹窗：父母本下拉显示编号+基因 ===== */
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  await wait(p, 400);
  await p.eval(`(() => {
    const m = ${lastModal()};
    const row = [...m.querySelectorAll('.pick-row')].find((r) => r.textContent.includes('睫角守宫'));
    if (row) row.click();
  })()`, { awaitPromise: false });
  await wait(p, 500);
  const formOpts = await p.eval(`(() => {
    const m = ${lastModal()};
    const ms = m.querySelector('#eg-mother'), fs = m.querySelector('#eg-father');
    return {
      title: (m.querySelector('.m-title') || {}).textContent,
      motherTxt: [...ms.options].map((o) => o.textContent).join('|'),
      fatherTxt: [...fs.options].map((o) => o.textContent).join('|'),
    };
  })()`);
  ok('记录产蛋母本下拉显示编号+基因',
    formOpts.motherTxt.includes(`V19母本${T}`) && formOpts.motherTxt.includes(parents.mCode) && formOpts.motherTxt.includes('· 缺黄'),
    formOpts.motherTxt.split('|').filter((t) => t.includes('V19')).join(' / '));
  ok('记录产蛋父本下拉显示编号+基因',
    formOpts.fatherTxt.includes(`V19父本${T}`) && formOpts.fatherTxt.includes(parents.fCode) && formOpts.fatherTxt.includes('· 莉莉白'),
    formOpts.fatherTxt.split('|').filter((t) => t.includes('V19')).join(' / '));
  await p.eval(`(() => {
    const m = ${lastModal()};
    [...m.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '取消').click();
  })()`, { awaitPromise: false });
  await wait(p, 300);

  /* ===== F. 蛋详情：编辑按钮 + 父母本编号基因 + 基因预测 ===== */
  await p.goto(BASE + '#/egg/' + parents.eggId, 1300);
  const detail1 = await p.eval(`(() => {
    const pv = [...document.querySelectorAll('.pv-row')];
    const mRow = pv.find((r) => r.querySelector('.k').textContent === '母本');
    const fRow = pv.find((r) => r.querySelector('.k').textContent === '父本');
    return {
      hasEdit: !!document.getElementById('btn-edit'),
      mother: mRow ? mRow.textContent : '',
      father: fRow ? fRow.textContent : '',
    };
  })()`);
  ok('蛋详情有「编辑」按钮', detail1.hasEdit, '');
  ok('蛋详情母本行显示编号+基因',
    detail1.mother.includes(`V19母本${T}`) && detail1.mother.includes(parents.mCode) && detail1.mother.includes('· 缺黄'),
    detail1.mother.trim());
  ok('蛋详情父本行显示编号+基因',
    detail1.father.includes(`V19父本${T}`) && detail1.father.includes(parents.fCode) && detail1.father.includes('· 莉莉白'),
    detail1.father.trim());

  // 编辑弹窗：标题/回填/保存
  await p.eval(`document.getElementById('btn-edit').click()`, { awaitPromise: false });
  await wait(p, 450);
  const editModal = await p.eval(`(() => {
    const m = ${lastModal()};
    return {
      title: (m.querySelector('.m-title') || {}).textContent,
      motherVal: m.querySelector('#eg-mother').value,
      fatherVal: m.querySelector('#eg-father').value,
      lay: m.querySelector('#eg-lay').value,
      note: m.querySelector('#eg-note').value,
    };
  })()`);
  ok('编辑弹窗标题为「编辑蛋」并回填父母本/日期',
    editModal.title.includes('编辑蛋') && editModal.motherVal === `${parents.motherId}` && editModal.fatherVal === `${parents.fatherId}` && editModal.lay === '2026-10-01',
    JSON.stringify(editModal));
  await p.eval(`(() => {
    const m = ${lastModal()};
    m.querySelector('#eg-note').value = 'V19编辑备注${T}';
    [...m.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await wait(p, 700);
  const edited = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const e = s.getEgg('${parents.eggId}');
    return { note: e && e.note, mother: e && e.motherId, father: e && e.fatherId };
  })()`, { awaitPromise: true });
  ok('编辑保存后备注更新且父母本不变', edited.note === `V19编辑备注${T}` && edited.mother === `${parents.motherId}` && edited.father === `${parents.fatherId}`, JSON.stringify(edited));

  // 基因预测：按父母本基因（v2.6 起不登记状态：母缺黄按隐性默认纯合、父莉莉白按不完全显性默认单拷贝）
  // 缺黄 locus：母 v × 父 n → 100% 杂合携带（名称加「隐」）；莉莉白 locus：母 n × 父 h → 50% 单拷贝 / 50% 不携带
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 500);
  const gp = await p.eval(`(() => {
    const m = ${lastModal()};
    const title = (m.querySelector('.m-title') || {}).textContent || '';
    const stateSels = [...m.querySelectorAll('.gp-st')];
    const geneTxt = m.innerText.replace(/\\s+/g, ' ');
    const rows = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { title, stateSelCount: stateSels.length, geneTxt, rows, hasImg: !!m.querySelector('#gp-img'), warn: !!m.querySelector('.warn-box') };
  })()`);
  ok('基因预测弹窗基于父母本基因（母缺黄/父莉莉白）',
    gp.title.includes('蛋基因预测') && gp.geneTxt.includes('缺黄') && gp.geneTxt.includes('莉莉白'),
    gp.geneTxt.slice(0, 200));
  ok('预测弹窗无基因状态选择器（v2.3 删除）', gp.stateSelCount === 0, String(gp.stateSelCount));
  ok('默认状态语义：缺黄母方单传（v×n→全杂合）→ 莉莉白+隐缺黄 50% / 隐缺黄 50%',
    gp.rows.length === 2
      && gp.rows.some((r) => r[0] === '50%' && r[1] === '莉莉白+缺黄' && r[2] === '莉莉白+隐缺黄')
      && gp.rows.some((r) => r[0] === '50%' && r[1] === '缺黄' && r[2] === '隐缺黄')
      && !gp.rows.some((r) => r[2].includes('超级')) && !gp.rows.some((r) => r[1] === '原色'),
    JSON.stringify(gp.rows));
  ok('母方单传缺黄：所有后代均携带缺黄（无「莉莉白」单行与「原色」行）',
    gp.rows.every((r) => r[1].includes('缺黄')), JSON.stringify(gp.rows));
  await p.eval(`(() => {
    const m = ${lastModal()};
    [...m.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '关闭').click();
  })()`, { awaitPromise: false });
  await wait(p, 300);

  /* ===== G. 爬柜清理周期更新 → 待办同步 ===== */
  // 注意：CDP 的 hash goto 会重载页面，boot() 的 initStore/refreshAutoTodos 与测试 eval 可能交错。
  // 这里重新加载一次页面并等 boot 完全结束，保证从确定的单 boot 完成态开始。
  await p.goto(BASE, 2000);
  await wait(p, 2500);
  const cyc = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    await s.initStore();
    await new Promise((r) => setTimeout(r, 300)); // 等 boot 残留异步链结束
    const today = u.todayStr();
    const plan = await s.createPlan('V19爬柜${T}', { capacity: 2, cleanCycle: 'week', lastCleanAt: today });
    const cage = await s.createCage(plan.id, { zone: 'adult' });
    await s.refreshAutoTodos();
    await new Promise((r) => setTimeout(r, 150));
    const todosOf = () => s.S.todo.filter((t) => t.sourceType === 'cage-clean' && t.sourceId === cage.id);
    // 立即深拷贝快照：todosOf() 返回的是对象引用，后续 syncCageCleanTodo 会就地改 status/deadline，
    // 若保存引用，最后统一读属性时四个时间点会显示同一最终值。
    const snap = () => todosOf().map((t) => ({ st: t.status, dl: t.deadline, id: t.id }));
    const t1 = snap();
    const dueAdd = (d) => { const [y, m, dd] = d.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); dt.setUTCDate(dt.getUTCDate() + 7); return dt.toISOString().slice(0, 10); };
    // 改周期 week → halfyear：due 变远（left>7）→ 待办取消
    await s.updatePlan(plan.id, { cleanCycle: 'halfyear' });
    await s.refreshAutoTodos();
    await new Promise((r) => setTimeout(r, 150));
    const t2 = snap();
    // 改回 week：due 回到 today+7 → 待办恢复 pending 且截止日同步
    await s.updatePlan(plan.id, { cleanCycle: 'week' });
    await s.refreshAutoTodos();
    await new Promise((r) => setTimeout(r, 150));
    const t3 = snap();
    // 改上次清理时间 today-3：due=today+4 → 待办截止日同步更新
    const d3 = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - 3)).toISOString().slice(0, 10);
    await s.updatePlan(plan.id, { lastCleanAt: d3 });
    await s.refreshAutoTodos();
    await new Promise((r) => setTimeout(r, 150));
    const t4 = snap();
    const allCC = s.S.todo.filter((t) => t.sourceType === 'cage-clean').map((t) => ({ sid: t.sourceId, mine: t.sourceId === cage.id, st: t.status, dl: t.deadline, at: t.createdAt }));
    const dd = s.cleanDueOf(cage);
    return {
      today, expectDue: dueAdd(today), cageId: cage.id, dd,
      allCC,
      t1: { n: t1.length, st: t1[0] && t1[0].st, dl: t1[0] && t1[0].dl, id: t1[0] && t1[0].id },
      t2: { n: t2.length, st: t2[0] && t2[0].st, dl: t2[0] && t2[0].dl, id: t2[0] && t2[0].id },
      t3: { n: t3.length, st: t3[0] && t3[0].st, dl: t3[0] && t3[0].dl, id: t3[0] && t3[0].id },
      t4: { n: t4.length, st: t4[0] && t4[0].st, dl: t4[0] && t4[0].dl },
    };
  })()`, { awaitPromise: true });
  ok('周期变长（week→半年）待办自动取消',
    cyc.t1.n === 1 && cyc.t1.st === 'pending' && cyc.t1.dl === cyc.expectDue && cyc.t2.st === 'cancelled',
    JSON.stringify({ t1: cyc.t1, t2: cyc.t2, allCC: cyc.allCC }));
  ok('周期改回（→week）待办恢复且截止日同步', cyc.t3.n === 1 && cyc.t3.st === 'pending' && cyc.t3.dl === cyc.expectDue && cyc.t3.id === cyc.t1.id, JSON.stringify(cyc.t3));
  ok('上次清理时间变更待办截止日同步更新', cyc.t4.n === 1 && cyc.t4.st === 'pending' && cyc.t4.dl !== cyc.expectDue && cyc.t4.dl < cyc.expectDue, JSON.stringify(cyc.t4));

  // UI 层：爬柜设置弹窗改周期 → 保存 → 待办同步
  await p.goto(BASE, 2000);
  await wait(p, 2500); // 干净 boot 态
  await p.goto(BASE + '#/cages', 1200);
  await wait(p, 1200);
  await p.eval(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('V19爬柜${T}'));
    const btn = card && card.querySelector('[data-act="settings"]');
    if (btn) btn.click();
  })()`, { awaitPromise: false });
  await wait(p, 450);
  const stModal = await p.eval(`(() => {
    const m = ${lastModal()};
    return { title: (m.querySelector('.m-title') || {}).textContent, cycle: m.querySelector('#st-cycle').value };
  })()`);
  ok('爬柜设置弹窗可打开且回填周期', stModal.title.includes('爬柜设置') && stModal.cycle === 'week', JSON.stringify(stModal));
  await p.eval(`(() => {
    const m = ${lastModal()};
    const sel = m.querySelector('#st-cycle');
    sel.value = 'quarter';
    sel.dispatchEvent(new Event('change'));
    [...m.querySelectorAll('.m-foot .btn')].find((x) => x.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await wait(p, 900);
  const uiSync = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const plan = s.S.cage_plan.find((p) => p.name === 'V19爬柜${T}');
    const cage = s.S.cage.find((c) => c.planId === plan.id);
    const t = s.S.todo.filter((x) => x.sourceType === 'cage-clean' && x.sourceId === cage.id);
    return { cycle: plan.cleanCycle, n: t.length, st: t[0] && t[0].status, dl: t[0] && t[0].deadline };
  })()`, { awaitPromise: true });
  ok('设置弹窗改周期保存后待办同步（quarter=90 天 → 超出 7 天窗口 → 取消）',
    uiSync.cycle === 'quarter' && uiSync.st === 'cancelled', JSON.stringify(uiSync));

  /* ---------- 汇总 ---------- */
  const pass = R.filter((r) => r[1]).length;
  console.log(`========== V1.9 汇总: ${pass}/${R.length} 通过 ==========`);
  const fails = R.filter((r) => !r[1]);
  if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  ❌ ' + f[0] + ' — ' + f[2])); }
});
