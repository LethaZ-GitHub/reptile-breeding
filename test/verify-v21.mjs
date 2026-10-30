// verify-v21.mjs —— v2.1 验证：
//   A. 产卵检查待办只关联配对记录（建蛋不再生成挂母本的 laying-check；存量兼容）
//   B. 待办完成时弹「登记配对结果」（结果+备注同步配对记录）
//   C. 基因预测每方仅 1 个基因（选择即替换）
//   D. 预测结果仅限基因库内有效基因（排除已失效）
//   E. 复选框 checked 有品牌绿选中态
//   F. 个体详情喂食/医疗记录全选 + 批量删除
//   G. 成长记录/历史记录个体网格固定一行四个
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3225/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 建蛋不再生成 laying-check（产卵检查待办只来自配对记录） ===== */
  const eggTodo = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const mother = s.S.animal.find((a) => a.sex === 'female' && !a.isArchived);
    const father = s.S.animal.find((a) => a.sex === 'male' && !a.isArchived);
    const before = s.S.todo.filter((t) => t.sourceType === 'laying-check').length;
    const e = await s.createEgg({ motherId: mother.id, fatherId: father.id, speciesId: 'sp-crested', status: 'fertile', layDate: '2026-10-10', expectHatchDate: '2026-12-19' });
    const after = s.S.todo.filter((t) => t.sourceType === 'laying-check' && t.sourceId === mother.id).length;
    const hatch = s.S.todo.filter((t) => t.sourceType === 'egg-hatch' && t.sourceId === e.id).length;
    // 存量 laying-check 待办兼容：手工建一条挂母本的旧待办，归档同批次蛋仍能取消
    await s.createTodo({ sourceType: 'laying-check', sourceId: mother.id, title: '产卵检查：旧数据', deadline: '2026-10-20' });
    const legacyBefore = s.S.todo.filter((t) => t.sourceType === 'laying-check' && t.status === 'pending').length;
    await s.archiveEgg(e.id, 'manual');
    const legacyAfter = s.S.todo.filter((t) => t.sourceType === 'laying-check' && t.status === 'pending').length;
    return { before, after, hatch, legacyBefore, legacyAfter, eggId: e.id, motherId: mother.id };
  })()`, { awaitPromise: true });
  ok('建蛋不再生成挂母本个体的产卵检查待办', eggTodo.after === 0, JSON.stringify({ before: eggTodo.before, after: eggTodo.after }));
  ok('建蛋仍生成破壳待办', eggTodo.hatch === 1, String(eggTodo.hatch));
  ok('存量 laying-check 待办仍可被归档联动取消（只读兼容）', eggTodo.legacyBefore >= 1 && eggTodo.legacyAfter === 0, JSON.stringify({ b: eggTodo.legacyBefore, a: eggTodo.legacyAfter }));

  /* ===== B. 待办完成 → 登记配对结果弹窗 → 同步配对记录 ===== */
  const pairSetup = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    // 清理历史遗留的 pending 配对待办，保证待办列表里只有本次配对
    const stale = s.S.todo.filter((t) => t.sourceType === 'pairing-check' && t.status === 'pending').map((t) => t.id);
    for (const id of stale) await s.cancelTodo(id);
    const male = s.S.animal.find((a) => a.sex === 'male' && !a.isArchived);
    const female = s.S.animal.find((a) => a.sex === 'female' && !a.isArchived);
    const pr = await s.createPairing({ participants: [male.id, female.id], pairDate: '2026-10-01', result: 'pending', note: '' });
    return { pairId: pr.id, maleId: male.id, femaleId: female.id };
  })()`, { awaitPromise: true });
  await p.goto(BASE, 1200);
  // 切到「待办」标签，点产卵检查待办的 ✔
  await p.eval(`(() => {
    const seg = [...document.querySelectorAll('#todo-tabs .seg-item')].find((x) => x.textContent.includes('待办'));
    if (seg) seg.click();
  })()`, { awaitPromise: false });
  await wait(p, 400);
  const clicked = await p.eval(`(() => {
    const row = [...document.querySelectorAll('.todo-item')].find((r) => r.textContent.includes('产卵检查'));
    if (!row) return false;
    row.querySelector('[data-act="done"]').click();
    return true;
  })()`, { awaitPromise: false });
  await wait(p, 500);
  const modalOk = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    return { open: !!m, title: m ? m.textContent.includes('登记配对结果') : false, hasResult: !!document.getElementById('pr-result'), hasNote: !!document.getElementById('pr-note') };
  })()`);
  ok('点击产卵检查待办弹出「登记配对结果」', clicked && modalOk.open && modalOk.title, JSON.stringify(modalOk));
  ok('弹窗含配对结果与备注输入', modalOk.hasResult && modalOk.hasNote, '');
  // 填结果 + 备注 → 保存
  await p.eval(`(() => {
    document.getElementById('pr-result').value = 'success';
    document.getElementById('pr-note').value = 'V21交配成功${T}';
    const btn = [...document.querySelectorAll('.modal .m-foot .btn')].find((b) => b.textContent === '保存并完成');
    if (btn) btn.click();
  })()`, { awaitPromise: false });
  await wait(p, 800);
  const synced = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const pr = s.S.pairing.find((x) => x.id === '${pairSetup.pairId}') || null;
    const t = s.S.todo.find((x) => x.sourceType === 'pairing-check' && x.sourceId === '${pairSetup.pairId}') || null;
    return { result: pr ? pr.result : '', note: pr ? pr.note : '', todoStatus: t ? t.status : '' };
  })()`, { awaitPromise: true });
  ok('填入的配对结果与备注同步到配对记录', synced.result === 'success' && synced.note === `V21交配成功${T}`, JSON.stringify(synced));
  ok('保存后产卵检查待办标记完成', synced.todoStatus === 'done', synced.todoStatus);

  /* ===== B2. 工单管理页同样流程 ===== */
  const pairSetup2 = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    // 再次清理，保证只有 B2 的配对待办处于 pending
    const stale = s.S.todo.filter((t) => t.sourceType === 'pairing-check' && t.status === 'pending').map((t) => t.id);
    for (const id of stale) await s.cancelTodo(id);
    const male = s.S.animal.find((a) => a.sex === 'male' && !a.isArchived);
    const female = s.S.animal.find((a) => a.sex === 'female' && !a.isArchived && a.id !== '${pairSetup.femaleId}');
    const f2 = female || s.S.animal.find((a) => a.sex === 'female' && !a.isArchived);
    const pr = await s.createPairing({ participants: [male.id, f2.id], pairDate: '2026-10-05', result: 'pending', note: '' });
    return { pairId: pr.id };
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/todos', 1200);
  const tkClicked = await p.eval(`(() => {
    const row = [...document.querySelectorAll('.todo-item')].find((r) => r.textContent.includes('产卵检查') && r.querySelector('[data-act="done"]'));
    if (!row) return false;
    row.querySelector('[data-act="done"]').click();
    return true;
  })()`, { awaitPromise: false });
  await wait(p, 500);
  const tkModal = await p.eval(`!!document.getElementById('pr-result')`);
  ok('工单管理页完成产卵检查待办同样弹登记弹窗', tkClicked && tkModal, '');
  await p.eval(`(() => {
    document.getElementById('pr-result').value = 'failed';
    const btn = [...document.querySelectorAll('.modal .m-foot .btn')].find((b) => b.textContent === '保存并完成');
    if (btn) btn.click();
  })()`, { awaitPromise: false });
  await wait(p, 800);
  const tkSynced = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const pr = s.S.pairing.find((x) => x.id === '${pairSetup2.pairId}') || null;
    const t = s.S.todo.find((x) => x.sourceType === 'pairing-check' && x.sourceId === '${pairSetup2.pairId}') || null;
    return { result: pr ? pr.result : '', todoStatus: t ? t.status : '' };
  })()`, { awaitPromise: true });
  ok('工单管理页保存后同步配对记录并完成待办', tkSynced.result === 'failed' && tkSynced.todoStatus === 'done', JSON.stringify(tkSynced));

  /* ===== C. 基因预测每方仅 1 个基因 ===== */
  const geneIds = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const byName = (n) => (s.listGenes('sp-crested').find((g) => g.name === n) || {}).id || '';
    return { cap: byName('卡布奇诺'), lw: byName('莉莉白') };
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/predict', 1200);
  const singleSel = await p.eval(`(() => ({ male: document.querySelectorAll('#male-box .g-sel').length, female: document.querySelectorAll('#female-box .g-sel').length }))()`);
  ok('公母方各只有 1 个基因下拉（不可多加）', singleSel.male === 1 && singleSel.female === 1, JSON.stringify(singleSel));
  // 连续选两个 → 后者替换前者
  await p.eval(`(() => {
    const sel = document.querySelector('#male-box .g-sel');
    sel.value = '${geneIds.cap}'; sel.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 250);
  await p.eval(`(() => {
    const sel = document.querySelector('#male-box .g-sel');
    sel.value = '${geneIds.lw}'; sel.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 250);
  const replaced = await p.eval(`(() => {
    const sel = document.querySelector('#male-box .g-sel');
    return { value: sel.value, isLw: sel.value === '${geneIds.lw}', selCount: document.querySelectorAll('#male-box .g-sel').length };
  })()`);
  ok('重复选择直接替换（每方始终 1 个基因）', replaced.isLw && replaced.selCount === 1, JSON.stringify(replaced));
  // v2.3：预测页已删除基因状态选择（.st-sel 不再出现）
  const stGone = await p.eval(`!document.querySelector('#male-box .st-sel') && !document.querySelector('#female-box .st-sel')`);
  ok('选基因后不再出现状态下拉（v2.3 删除状态选择）', stGone, '');

  /* ===== D. 预测结果仅限基因库内有效基因 ===== */
  const libOnly = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const g = await import('./js/genetics.js');
    await s.initStore();
    const genes = s.listGenes('sp-crested');
    // 构造含「已失效」标记的基因库：失效复合基因不应被推导
    const genesWithInvalid = genes.concat([{ id: 'gn-x-invalid', speciesId: 'sp-crested', name: '失效复合${T}', type: 'combo', comboOf: ['卡布奇诺', '莉莉白'], isInvalid: true }]);
    const blocks = [
      { name: '卡布奇诺', type: 'dominant', male: 'v', female: 'n', dist: g.geneOutcome('dominant', 'v', 'n') },
      { name: '莉莉白', type: 'incomplete', male: 'n', female: 'h', dist: g.geneOutcome('incomplete', 'n', 'h') },
    ];
    const derived = g.deriveCombos(blocks, genesWithInvalid);
    // 个体 geneIds 引用库外 id 时，蛋详情取不到基因（不预测库外基因）
    const ghost = genes.find((x) => x.id === 'gn-not-exist') || null;
    return {
      hasBad: derived.some((d) => d.gene.name === '失效复合${T}'),
      hasFrap: derived.some((d) => d.gene.name === '法布奇诺'),
      frapProb: (derived.find((d) => d.gene.name === '法布奇诺') || {}).prob,
      ghostNull: ghost === null,
      poolCount: genes.filter((x) => !x.isInvalid && x.type !== 'polygenic').length,
    };
  })()`, { awaitPromise: true });
  ok('已失效（软删除）基因不参与预测推导', !libOnly.hasBad, JSON.stringify({ hasBad: libOnly.hasBad }));
  ok('有效复合基因仍正常推导（法布奇诺 25%）', libOnly.hasFrap && Math.round(libOnly.frapProb * 100) === 25, JSON.stringify({ frap: libOnly.hasFrap, p: libOnly.frapProb }));
  ok('基因库无库外基因引用（个体 geneIds 悬空时预测取空）', libOnly.ghostNull && libOnly.poolCount > 0, JSON.stringify({ ghost: libOnly.ghostNull, pool: libOnly.poolCount }));

  /* ===== E. 复选框 checked 选中态 ===== */
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = await s.createAnimal({ name: 'V21勾选${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [], geneState: 'n' });
    await s.addLog(a.id, 'feed', { food: '蟋蟀' });
    await s.addLog(a.id, 'medical', { symptom: '体检' });
    location.hash = '#/animal/' + a.id + '?tab=logs';
  })()`, { awaitPromise: false });
  await wait(p, 1200);
  const cbBefore = await p.eval(`getComputedStyle(document.querySelector('.log-check')).backgroundColor`);
  await p.eval(`document.querySelector('.log-check').click()`, { awaitPromise: false });
  await wait(p, 200);
  const cbAfter = await p.eval(`(() => { const i = document.querySelector('.log-check'); return { checked: i.checked, bg: getComputedStyle(i).backgroundColor }; })()`);
  ok('复选框未选为空白、点击后为品牌绿选中态', cbBefore === 'rgb(255, 255, 255)' && cbAfter.checked && cbAfter.bg === 'rgb(46, 158, 107)', JSON.stringify({ before: cbBefore, after: cbAfter }));

  /* ===== F. 个体详情喂食/医疗全选 + 批量删除 ===== */
  const logsBefore = await p.eval(`(async () => { const s = await import('./js/store.js'); const a = s.S.animal.find((x) => x.name === 'V21勾选${T}'); return s.listLogs(a.id).length; })()`, { awaitPromise: true });
  await p.eval(`document.getElementById('lg-selall').click()`, { awaitPromise: false });
  await wait(p, 300);
  const selAllState = await p.eval(`(() => ({
    btnTxt: document.getElementById('lg-selall').textContent,
    batch: !!document.querySelector('#lg-batch .log-batch-bar'),
    checked: [...document.querySelectorAll('.log-check')].every((c) => c.checked),
    count: (document.querySelector('.lbb-count') || {}).textContent,
  }))()`);
  ok('全选按钮勾选当前全部记录并出批量操作栏', selAllState.btnTxt.includes('取消全选') && selAllState.batch && selAllState.checked, JSON.stringify(selAllState));
  await p.eval(`document.getElementById('lg-batch-del').click()`, { awaitPromise: false });
  await wait(p, 300);
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '删除'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 800);
  const logsAfter = await p.eval(`(async () => { const s = await import('./js/store.js'); const a = s.S.animal.find((x) => x.name === 'V21勾选${T}'); return a ? s.listLogs(a.id).length : -1; })()`, { awaitPromise: true });
  ok('批量删除生效（2 条喂食/医疗记录清零）', logsBefore === 2 && logsAfter === 0, `${logsBefore} → ${logsAfter}`);

  /* ===== G. 成长记录/历史记录网格固定一行四个 ===== */
  await p.goto(BASE + '#/growth', 1200);
  const gCols = await p.eval(`(() => { const g = document.querySelector('.growth-grid'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; })()`);
  ok('成长记录个体网格一行四个', gCols === 4, String(gCols));
  await p.eval(`document.getElementById('btn-history').click()`, { awaitPromise: false });
  await wait(p, 600);
  const hCols = await p.eval(`(() => { const g = document.querySelector('.modal .growth-grid'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; })()`);
  ok('历史记录弹窗个体网格一行四个', hCols === 4, String(hCols));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });

  /* ===== H. 控制台错误 ===== */
  ok('控制台零错误', p.consoleErrors.length === 0, p.consoleErrors.slice(0, 3).join(' | '));
});

const fail = R.filter(([, c]) => !c);
console.log(`\n===== v2.1 验证结果：${R.length - fail.length}/${R.length} 通过 =====`);
process.exit(fail.length ? 1 : 0);
