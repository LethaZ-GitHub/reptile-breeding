// test/e2e.mjs —— 全量 E2E：路由渲染 + 数据流 + UI 交互
import { withBrowser } from './cdp.mjs';

const BASE = 'http://localhost:3210/';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log((pass ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
};

await withBrowser(async (api) => {
  /* ---------- 1. 路由渲染 ---------- */
  const routes = [
    ['#/home', '首页待办'], ['#/animals', '个体列表'], ['#/animals/archive', '个体归档'],
    ['#/animal/new', '新建个体'], ['#/eggs', '蛋管理'], ['#/eggs/archive', '蛋归档'],
    ['#/cages', '爬柜方案'], ['#/predict', '基因配对预测'], ['#/genes', '基因库'],
    ['#/species', '物种库'], ['#/pairings', '配对记录'], ['#/growth', '成长记录'],
    ['#/logs', '饲养日志'], ['#/tags', '标签管理'],
    ['#/bills', '记账报表'], ['#/reports', '月度报表'], ['#/backup', '备份与恢复'],
    ['#/share', '个体分享'], ['#/settings', '设置'], ['#/more', '更多功能'],
  ];
  for (const [hash, marker] of routes) {
    await api.goto(BASE + hash, 900);
    const r = await api.eval(`(() => {
      const v = document.getElementById('view');
      return JSON.stringify({ len: v.innerHTML.length, title: document.title, text: v.innerText.slice(0,120), fail: v.innerText.includes('页面加载失败') });
    })()`);
    const o = JSON.parse(r);
    ok('路由 ' + hash, !o.fail && o.len > 150 && o.text.includes(marker), `len=${o.len}`);
  }

  /* ---------- 2. 数据流 E2E（页面上下文直接调 store） ---------- */
  const dataTest = await api.eval(`(async () => {
    const R = [];
    const s = await import('/js/store.js');
    const u = await import('/js/util.js');
    const g = await import('/js/genetics.js');
    try {
      await s.initStore();
      R.push(['seed species', s.listSpecies().length >= 2]);
      R.push(['seed genes', s.listGenes('sp-crested').length >= 5]);
      // 物种
      const sp = await s.createSpecies('测试守宫');
      R.push(['custom species', !!sp.id]);
      // 个体
      const a = await s.createAnimal({ name: '数据流一号', speciesId: sp.id, sex: 'female', buyPrice: 520, weight: 30, length: 25, geneIds: [s.listGenes('sp-crested')[0].id], tagIds: [] });
      const b = await s.createAnimal({ name: '数据流二号', speciesId: sp.id, sex: 'male' });
      await s.createTag('高白', '#123456');
      const tg = s.listTags().find(t => t.name === '高白');
      await s.updateAnimal(a.id, { tagIds: [tg.id] });
      R.push(['animal created', s.getAnimal(a.id).name === '数据流一号']);
      // 购入自动账单
      const bills1 = s.listBills({ type: 'expense' }).filter(x => x.relatedAnimalId === a.id);
      R.push(['buy auto-bill', bills1.length === 1 && bills1[0].amount === 520 && bills1[0].category === '购宠']);
      // 售出 → 自动收入 + 归档
      await s.updateAnimal(a.id, { status: 'sold', soldPrice: 1200, soldDate: '2026-10-05' });
      const inc = s.listBills({ type: 'income' }).filter(x => x.relatedAnimalId === a.id);
      R.push(['sold auto-income + archived', inc.length === 1 && inc[0].amount === 1200 && s.getAnimal(a.id).isArchived === true]);
      // 报表（售出收入默认不计入，开启后才计入）
      const repOff = s.reportOf('2026-10');
      const { setSetting } = await import('/js/settings.js');
      setSetting('countSoldIncome', true);
      await s.syncSoldIncomeFlag(true);
      const repOn = s.reportOf('2026-10');
      R.push(['report expense counted', repOff.expTotal >= 520]);
      R.push(['report sold income toggle', repOff.incTotal === 0 && repOn.incTotal >= 1200]);
      setSetting('countSoldIncome', false);
      await s.syncSoldIncomeFlag(false);
      // 日志 + measure 联动
      await s.addLog(b.id, 'measure', { weight: 15, length: 20 });
      R.push(['measure log updates animal', s.getAnimal(b.id).weight === 15 && s.getAnimal(b.id).length === 20]);
      await s.addLog(b.id, 'feed', { food: '蟋蟀', qty: '3 只', ate: '吃完' });
      await s.addLog(b.id, 'medical', { symptom: '体检', treatment: '正常' });
      R.push(['logs', s.listLogs(b.id).length === 3]);
      // 蛋 + 待办
      const e1 = await s.createEgg({ motherId: a.id, fatherId: b.id, speciesId: sp.id, status: 'fertile', layDate: '2026-10-01', expectHatchDate: '2026-11-01' });
      const t1 = s.listTodos('pending').filter(t => t.sourceType === 'egg-hatch' && t.sourceId === e1.id);
      // v2.1 起产卵检查待办只由配对记录生成，建蛋不再生成挂母本个体的 laying-check 待办
      const t2 = s.listTodos('pending').filter(t => t.sourceType === 'laying-check');
      R.push(['egg hatch todo only (no laying-check on egg)', t1.length === 1 && t1[0].deadline === '2026-11-01' && t2.length === 0]);
      await s.archiveEgg(e1.id, 'manual');
      R.push(['archive cancels hatch todo', s.listTodos('pending').filter(t => t.sourceType === 'egg-hatch' && t.sourceId === e1.id).length === 0]);
      // 蛋状态回 fertile 恢复待办
      await s.unarchiveEgg(e1.id);
      await s.updateEgg(e1.id, { status: 'infertile' });
      R.push(['non-fertile cancels todo', s.listTodos('pending').filter(t => t.sourceType === 'egg-hatch' && t.sourceId === e1.id).length === 0]);
      await s.updateEgg(e1.id, { status: 'fertile' });
      R.push(['re-fertile restores todo', s.listTodos('pending').filter(t => t.sourceType === 'egg-hatch' && t.sourceId === e1.id).length === 1]);
      // 母体累计产蛋
      R.push(['mother egg count', s.eggCountOfMother(a.id) === 1]);
      // 爬箱
      const plan = await s.createPlan('测试爬柜', { capacity: 3, lastCleanAt: '2026-10-01' });
      R.push(['plan capacity/cycle defaults', plan.capacity === 3 && plan.cleanCycle === 'month' && plan.lastCleanAt === '2026-10-01']);
      const cage = await s.createCage(plan.id, { sizeType: 'A4', zone: 'adult', lastCleanAt: '2026-10-01' });
      const due = s.cleanDueOf(cage);
      // left 是“距今天数”，必须按运行日动态计算（写死会在跨天后假失败）
      R.push(['clean due calc', due.due === '2026-10-31' && due.left === u.daysBetween(u.todayStr(), due.due)]);
      await s.bindAnimalToCage(b.id, cage.id);
      R.push(['bind cage', s.animalsInCage(cage.id).length === 1 && s.getAnimal(b.id).cageId === cage.id]);
      await s.bindAnimalToCage(b.id, null);
      R.push(['unbind cage', s.animalsInCage(cage.id).length === 0]);
      // 自动待办（清理到期前 7 天可见）
      const soon = await s.createCage(plan.id, { sizeType: 'A3', lastCleanAt: u.addDays(u.todayStr(), -23) });
      await s.updatePlan(plan.id, { lastCleanAt: u.addDays(u.todayStr(), -23) });
      await s.refreshAutoTodos();
      R.push(['auto clean todo', s.listTodos('pending').some(t => t.sourceType === 'cage-clean' && t.sourceId === soon.id)]);
      // 方案级清理周期：改为“每周”→ 下次清理 = 上次清理 + 7 天
      await s.updatePlan(plan.id, { cleanCycle: 'week', lastCleanAt: '2026-10-01' });
      const weekDue = s.cleanDueOf(cage);
      R.push(['plan cycle week', weekDue.due === '2026-10-08' && weekDue.days === 7]);
      await s.updatePlan(plan.id, { cleanCycle: 'month' });
      // 基因预测（引擎与库解耦：用自定义不完全显性基因验证超级体逻辑）
      const genesC = s.listGenes('sp-crested');
      const incGene = await s.createGene({ speciesId: 'sp-crested', name: '测试不完全', en: 'Test Incomplete', type: 'incomplete', desc: 'e2e 临时基因' });
      const ax = genesC.find(x => x.name === '缺黄');
      const r1 = g.predictPairing([{ id: incGene.id, name: incGene.name, type: incGene.type, male: 'h', female: 'h' }]);
      const lwItems = r1.rows[0].items;
      R.push(['incomplete dominant 25% super', lwItems.find(i => i.super && i.prob === 25) !== undefined]);
      const r2 = g.predictPairing([{ id: ax.id, name: ax.name, type: ax.type, male: 'h', female: 'h' }]);
      R.push(['recessive 25% visual', r2.rows[0].items.find(i => i.label === '看得到（纯合）' && i.prob === 25) !== undefined]);
      R.push(['warnings on super risk', r1.warnings.length >= 1]);
      await s.removeGene(incGene.id);
      // 配对记录
      const pa = await s.createAnimal({ name: '配对公', speciesId: 'sp-crested', sex: 'male' });
      const pb = await s.createAnimal({ name: '配对母', speciesId: 'sp-crested', sex: 'female' });
      const pr = await s.createPairing({ participants: [pa.id, pb.id], pairDate: '2026-10-08', result: 'success', note: '测试配对' });
      R.push(['pairing created', !!pr.id && s.listPairings(pa.id).length === 1 && s.listPairings().length >= 1]);
      // 配对自动生成产卵检查待办（配对日期 + 20 天）
      const pairTodo = s.listTodos('pending').find(t => t.sourceType === 'pairing-check' && t.sourceId === pr.id);
      R.push(['pairing auto todo +20d', !!pairTodo && pairTodo.deadline === '2026-10-28', JSON.stringify(pairTodo)]);
      await s.updatePairing(pr.id, { result: 'failed' });
      R.push(['pairing updated', s.getPairing(pr.id).result === 'failed']);
      await s.removePairing(pr.id);
      R.push(['pairing removed', s.listPairings(pa.id).length === 0 && !s.listTodos('pending').some(t => t.sourceType === 'pairing-check' && t.sourceId === pr.id)]);
      // 基因库恢复出厂 / 导入导出
      const genePkg = s.exportGenes();
      R.push(['gene export shape', genePkg.app === 'reptile-breeding-genes' && genePkg.genes.length >= 10]);
      const geneCountBefore = s.listGenes().length;
      await s.importGenes({ app: 'reptile-breeding-genes', format: 1, genes: [{ id: 'gn-test-import', speciesId: 'sp-crested', name: '导入测试基因', type: 'recessive' }] }, 'merge');
      R.push(['gene import merge', s.listGenes().length === geneCountBefore + 1]);
      await s.resetGenes();
      R.push(['gene reset', s.listGenes().some(g => g.id === 'gn-test-import') === false && s.listGenes().length >= 10]);
      // 备份
      const pkg = s.buildBackup();
      s.validateBackup(pkg);
      R.push(['backup shape', pkg.tables.animal.length >= 2 && pkg.tables.gene.length >= 10]);
      R.push(['backup has pairing table', Array.isArray(pkg.tables.pairing)]);
      R.push(['backup has no morph table', pkg.tables.morph === undefined]);
      // 分享包 + 导入
      const share = s.buildShare(b.id);
      s.validateShare(share);
      R.push(['share excludes lineage', share.animal.motherId === null && share.animal.fatherId === null]);
      const back = await s.importShare(share);
      R.push(['share import new uuid', back.animal.id !== b.id && back.animal.name === b.name]);
      // 删除个体级联
      const beforeLogs = s.listLogs(b.id).length;
      const beforeEggs = s.listEggs({ motherId: a.id }).length;
      await s.removeAnimal(a.id);
      R.push(['cascade delete', s.getAnimal(a.id) === null && s.listEggs({ motherId: a.id }).length === 0 && s.listLogs(b.id).length === beforeLogs]);
      // 被用物种禁删
      let blocked = false;
      try { await s.removeSpecies(sp.id); } catch (e) { blocked = true; }
      R.push(['used species delete blocked', blocked]);
      // 标签删除剥离
      const tg2 = s.listTags().find(t => t.name === '高白');
      await s.removeTag(tg2.id);
      R.push(['tag removal strips animals', s.listTags().length === 0]);
      // 基因硬删除（引用该基因的个体同步移除）
      const custom = await s.createGene({ speciesId: sp.id, name: '测试基因', type: 'recessive', desc: '' });
      await s.updateAnimal(b.id, { geneIds: [custom.id] });
      const removedRefs = await s.removeGene(custom.id);
      R.push(['gene hard delete', s.listGenes(sp.id).find(x => x.id === custom.id) === undefined && !s.getAnimal(b.id).geneIds.includes(custom.id) && removedRefs === 1]);
      // 备份导入原子性
      const before = s.listAnimals().length;
      let atomicFail = false;
      try { await s.importBackup({ app: 'reptile-breeding', format: 1, tables: { animal: [{ id: 'x' }] } }); } catch (e) { atomicFail = true; }
      R.push(['bad backup rejected', atomicFail && s.listAnimals().length === before]);
      const R2 = R.map(([n, p]) => [n, !!p]);
      return JSON.stringify(R2);
    } catch (e) {
      return JSON.stringify({ fatal: e.message + ' @ ' + (e.stack || '').split('\\n')[1] });
    }
  })()`, { awaitPromise: true });
  const dr = JSON.parse(dataTest);
  if (dr.fatal) { ok('数据流 E2E', false, dr.fatal); }
  else { dr.forEach(([n, p]) => ok('数据 · ' + n, p)); }

  /* ---------- 3. UI 交互 ---------- */
  await api.goto(BASE + '#/animal/new', 900);
  const created = await api.eval(`(async () => {
    document.getElementById('f-name').value = '交互测试个体';
    document.getElementById('f-name').dispatchEvent(new Event('input'));
    document.getElementById('f-buyprice').value = '88';
    document.getElementById('btn-save').click();
    await new Promise(r => setTimeout(r, 1500));
    return location.hash;
  })()`, { awaitPromise: true });
  ok('表单创建个体跳转详情', /#\/animal\/.+/.test(created || ''), created);

  if (created && created.includes('#/animal/')) {
    await api.goto(BASE + created, 900);
    const detail = await api.eval(`document.getElementById('view').innerText`);
    ok('详情页渲染名字+基因下拉', detail.includes('交互测试个体') && detail.includes('概况'));
    // 切标签页
    await api.eval(`document.querySelector('[data-tab="photos"]').click()`);
    await api.waitFor(`location.hash.includes('tab=photos')`, 3000);
    const photos = await api.eval(`document.getElementById('view').innerText`);
    ok('照片标签页', photos.includes('最多 3 张照片'));
    await api.eval(`document.querySelector('[data-tab="logs"]').click()`);
    await api.waitFor(`location.hash.includes('tab=logs')`, 3000);
    await api.eval(`document.querySelector('[data-add="measure"]').click()`);
    const hasModal = await api.waitFor(`!!document.querySelector('.modal')`, 2000);
    ok('日志弹窗打开', !!hasModal);
    if (hasModal) {
      await api.eval(`document.getElementById('lg-w').value = '31'; document.getElementById('lg-l').value = '26'; document.querySelector('.modal .m-foot .btn:not(.ghost)').click();`);
      // 等弹窗关闭且列表已渲染出新记录（不能把 toast 当提前退出条件：toast 比重排更早出现）
      await api.waitFor(`!document.querySelector('.modal') && document.getElementById('view').innerText.includes('31')`, 4000);
      const logs = await api.eval(`document.getElementById('view').innerText`);
      ok('体重体长日志录入并展示', logs.includes('31'));
    }
    // 谱系弹窗（v2.6：入口移到名字行最右侧，点击弹窗展示）
    await api.eval(`document.getElementById('btn-pedigree').click()`);
    await api.waitFor(`!!document.querySelector('.modal #pedm-svg')`, 3000);
    const pedModal = await api.eval(`(() => {
      const m = document.querySelector('.modal');
      return {
        title: (m.querySelector('.m-title') || {}).textContent || '',
        nodes: m.querySelectorAll('.ped-node').length,
        zoom: !!m.querySelector('#pedm-zoom'),
        txt: document.getElementById('view').innerText,
      };
    })()`);
    ok('谱系弹窗展示三代树（含放大按钮）', pedModal.nodes >= 1 && pedModal.zoom && pedModal.title.includes('族谱'), JSON.stringify(pedModal));
    // 放大：全屏查看器打开且 SVG 有实际宽高（v2.6 修复无宽高属性塌缩导致不显示）
    await api.eval(`document.getElementById('pedm-zoom').click()`);
    await api.waitFor(`document.querySelector('.zoom-viewer').classList.contains('open')`, 3000);
    const pedZoom = await api.eval(`(() => {
      const s = document.querySelector('.zoom-viewer svg');
      return s ? { w: Number(s.getAttribute('width')), h: Number(s.getAttribute('height')), nodes: s.querySelectorAll('.ped-node').length } : null;
    })()`);
    ok('谱系放大在全屏查看器打开且 SVG 有实际尺寸', !!pedZoom && pedZoom.w > 100 && pedZoom.h > 50 && pedZoom.nodes >= 1, JSON.stringify(pedZoom));
    await api.eval(`(async () => { const m = await import('/js/lightbox.js'); m.closeZoomViewer(); })()`);
    await api.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].pop(); if (b) b.click(); })()`);
  }

  // 列表页确认个体出现
  await api.goto(BASE + '#/animals', 900);
  ok('个体列表出现新个体', (await api.eval(`document.getElementById('view').innerText`)).includes('交互测试个体'));

  /* ---------- 4. 爬柜（文字列表版） ---------- */
  await api.eval(`(async () => {
    const s = await import('/js/store.js');
    await s.initStore();
    const p = await s.createPlan('UI测试爬柜', { capacity: 2, lastCleanAt: '2026-10-01' });
    location.hash = '#/cage/' + p.id;
  })()`, { awaitPromise: true });
  await api.waitFor(`document.querySelector('#cage-list')`, 3000);
  ok('文字布局渲染空箱提示', (await api.eval(`document.getElementById('cage-list').innerText`)).includes('还没有爬箱'));
  // 添加一个爬箱（无尺寸参数 / 一行三列卡片）
  await api.eval(`document.getElementById('btn-add-cage').click()`);
  await api.waitFor(`document.querySelector('.modal #cg-zone')`, 2000);
  await api.eval(`document.querySelector('.modal .m-foot .btn:not(.ghost)').click()`);
  await api.waitFor(`document.querySelectorAll('#cage-list .cage-cell').length >= 1`, 4000);
  const cageTxt = await api.eval(`document.getElementById('cage-list').innerText`);
  ok('添加爬箱后卡片展示（序号+空箱，无尺寸）', cageTxt.includes('爬箱 1') && cageTxt.includes('空箱') && !/cm|规格/.test(cageTxt), cageTxt.slice(0, 80));
  const cageCols = await api.eval(`getComputedStyle(document.querySelector('.cage-grid')).gridTemplateColumns.split(' ').length`);
  ok('爬箱卡片一行三列', cageCols === 3, String(cageCols));
  ok('无 3D 舞台渲染', (await api.eval(`!!document.querySelector('#iso-svg, .iso-host')`)) === false);
  // 点击爬箱卡片 → 预览弹窗
  await api.eval(`document.querySelector('#cage-list .cage-cell').click()`);
  const preview = await api.waitFor(`document.querySelector('.modal .cage-preview')`, 3000);
  ok('爬箱预览卡片', !!preview);
  if (preview) {
    const txt = await api.eval(`document.querySelector('.modal').innerText`);
    ok('预览含清理倒计时', txt.includes('下次清理'));
    await api.eval(`document.querySelector('.modal .m-close').click()`);
  }
  // 方案页：新建弹窗含 名称 / 可放爬箱数 / 上次清理时间
  await api.goto(BASE + '#/cages', 900);
  await api.eval(`document.getElementById('btn-new').click()`);
  await api.waitFor(`document.querySelector('.modal #pl-name')`, 2000);
  const newPlanTxt = await api.eval(`document.querySelector('.modal').innerText`);
  ok('新建爬柜三要素', newPlanTxt.includes('方案名称') && newPlanTxt.includes('可放爬箱数') && newPlanTxt.includes('上次清理时间'), newPlanTxt.slice(0, 120));
  await api.eval(`document.querySelector('.modal .m-close').click()`);
  // 设置按钮：清理周期 周/月/季/半年
  const setBtn = await api.waitFor(`document.querySelector('#plan-list .card [data-act="settings"]')`, 2000);
  ok('方案设置按钮存在', !!setBtn);
  if (setBtn) {
    await api.eval(`document.querySelector('#plan-list .card [data-act="settings"]').click()`);
    await api.waitFor(`document.querySelector('.modal #st-cycle')`, 2000);
    const cycleOpts = await api.eval(`[...document.querySelectorAll('.modal #st-cycle option')].map(o => o.textContent)`);
    ok('清理周期四选项', cycleOpts.length === 4 && cycleOpts.some(t => t.includes('每周')) && cycleOpts.some(t => t.includes('每月')) && cycleOpts.some(t => t.includes('每季')) && cycleOpts.some(t => t.includes('每半年')), cycleOpts.join('/'));
    await api.eval(`document.querySelector('.modal .m-close').click()`);
  }


  /* ---------- 5. 主题切换 ---------- */
  await api.goto(BASE + '#/settings', 900);
  const beforeTheme = await api.eval(`document.documentElement.dataset.theme`);
  await api.eval(`document.querySelector('#u-theme button[data-v="dark"]').click()`);
  await api.waitFor(`document.documentElement.dataset.theme === 'dark'`, 2000);
  const afterTheme = await api.eval(`document.documentElement.dataset.theme`);
  ok('主题切换', beforeTheme !== afterTheme && afterTheme === 'dark', beforeTheme + ' → ' + afterTheme);
  await api.eval(`document.querySelector('#u-theme button[data-v="light"]').click()`);

  /* ---------- 6. 预测页 ---------- */
  await api.goto(BASE + '#/predict', 900);
  await api.eval(`(() => { const s=document.querySelector('#male-box .g-sel'); const o=[...s.options][1]; if(o) o.selected=true; s.dispatchEvent(new Event('change')); })()`);
  await api.eval(`(() => { const s=document.querySelector('#female-box .g-sel'); const o=[...s.options][1]; if(o) o.selected=true; s.dispatchEvent(new Event('change')); })()`);
  await api.eval(`document.getElementById('btn-run').click()`);
  const predOk = await api.waitFor(`!!document.querySelector('.modal .gp-table')`, 3000);
  ok('基因预测运行（弹窗结果表）', !!predOk);
  if (predOk) ok('预测结果表含概率列', (await api.eval(`document.querySelector('.modal .gp-table').innerText`)).includes('%'));

  /* ---------- 汇总 ---------- */
  const fails = results.filter((r) => !r.pass);
  console.log(`\n========== E2E 汇总: ${results.length - fails.length}/${results.length} 通过 ==========`);
  if (api.consoleErrors.length) console.log('控制台错误:', JSON.stringify(api.consoleErrors, null, 1));
  process.exitCode = fails.length ? 1 : 0;
}, { port: 9222 });
