// verify-v13.mjs —— 本轮验证：基因单选 / 公禁产蛋 / 铲屎官 / 唯一编号 / 孵化温度自动算 / 批量产蛋 / 配对待办 / 爬柜文字化+清理周期 / 分享铲屎官可选
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3244/';
const R = [];
const ok = (n, c, d) => R.push([n, c, d]);

const p2 = (n) => String(n).padStart(2, '0');
const addDaysStr = (d, n) => {
  const t = new Date(d + 'T00:00:00');
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
};
const T = String(Date.now()).slice(-6); // 运行唯一后缀
const AN1 = 'V13基因单选' + T, AN2 = 'V13铲屎官个体' + T, AN3 = 'V13测试爬柜' + T;
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });

const api = await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. 基因单选 ===== */
  await p.goto(BASE + '#/animal/new', 900);
  const geneEl = await p.eval(`(() => {
    const box = document.getElementById('f-genes');
    const sel = box.querySelector('select');
    return { tag: sel ? sel.tagName : null, id: sel ? sel.id : null, opts: sel ? sel.querySelectorAll('option').length : 0, chips: box.querySelectorAll('.chip').length };
  })()`);
  ok('基因为单选下拉（无多选 chips）', geneEl.tag === 'SELECT' && geneEl.id === 'f-gene-sel' && geneEl.opts > 1 && geneEl.chips === 0, JSON.stringify(geneEl));
  await p.eval(`document.getElementById('f-name').value = '${AN1}'; document.getElementById('f-gene-sel').value = document.getElementById('f-gene-sel').options[1].value; document.getElementById('f-gene-sel').dispatchEvent(new Event('change')); document.getElementById('btn-save').click()`, { awaitPromise: false });
  await wait(p, 800);
  const geneSingle = await p.eval(`(async () => { const m = await import('./js/store.js'); const a = m.S.animal.find(x => x.name === '${AN1}'); return a ? { n: (a.geneIds || []).length, code: a.code, gene: m.geneName(a.geneIds[0]) } : null; })()`, { awaitPromise: true });
  ok('保存后基因仅 1 个', geneSingle && geneSingle.n === 1, JSON.stringify(geneSingle));
  ok('个体编号含基因缩写（形如 LW-001）', geneSingle && /^[A-Z]{2,}-\d{3}$/.test(geneSingle.code || ''), JSON.stringify(geneSingle));
  const dupCodes = await p.eval(`(async () => { const m = await import('./js/store.js'); const cs = m.S.animal.map(a => a.code).filter(Boolean); return { total: cs.length, uniq: new Set(cs).size }; })()`, { awaitPromise: true });
  ok('个体编号全局不重复', dupCodes.total === dupCodes.uniq, JSON.stringify(dupCodes));

  /* ===== B. 铲屎官 ===== */
  await p.goto(BASE + '#/settings', 900);
  ok('设置页有铲屎官名输入项', await p.eval(`!!document.getElementById('inp-keeper') && !!document.getElementById('btn-keeper-save')`), '');
  await p.eval(`document.getElementById('inp-keeper').value = 'V13铲屎官'; document.getElementById('btn-keeper-save').click()`, { awaitPromise: false });
  await wait(p, 300);
  const keeperSaved = await p.eval(`(async () => { const s = await import('./js/settings.js'); return s.getSetting('keeperName'); })()`, { awaitPromise: true });
  ok('铲屎官名保存生效', keeperSaved === 'V13铲屎官', keeperSaved);
  await p.goto(BASE + '#/animal/new', 900);
  const keeperPrefill = await p.eval(`document.getElementById('f-keeper').value`);
  ok('新建个体自动填入铲屎官名', keeperPrefill === 'V13铲屎官', keeperPrefill);
  await p.eval(`document.getElementById('f-name').value = '${AN2}'; document.getElementById('btn-save').click()`, { awaitPromise: false });
  await wait(p, 800);
  const keeperStored = await p.eval(`(async () => { const m = await import('./js/store.js'); const a = m.S.animal.find(x => x.name === '${AN2}'); return a ? a.keeper : null; })()`, { awaitPromise: true });
  ok('个体保存铲屎官属性', keeperStored === 'V13铲屎官', keeperStored);
  // 个体详情展示编号 + 铲屎官
  await p.eval(`(async () => { const m = await import('./js/store.js'); location.hash = '#/animal/' + m.S.animal.find(x => x.name === '${AN2}').id; })()`, { awaitPromise: false });
  await wait(p, 900);
  const detailTxt = await p.eval(`document.getElementById('view').textContent`);
  ok('个体详情展示编号与铲屎官', detailTxt.includes('编号') && detailTxt.includes('V13铲屎官'), detailTxt.slice(0, 100));

  /* ===== C. 公个体禁产蛋 ===== */
  await p.eval(`(async () => { const m = await import('./js/store.js'); const a = m.S.animal.find(x => x.name === '${AN1}'); await m.updateAnimal(a.id, { sex: 'male' }); location.hash = '#/animal/' + a.id + '?tab=breeding'; })()`, { awaitPromise: false });
  await wait(p, 1000);
  const maleBreed = await p.eval(`({ btn: !!document.getElementById('btn-add-egg'), txt: document.getElementById('view').textContent })`);
  ok('公个体无「记录产蛋」按钮', maleBreed.btn === false, '');
  ok('公个体繁殖页有禁用提示', maleBreed.txt.includes('公个体不记录产蛋'), maleBreed.txt.slice(0, 80));

  /* ===== D. 孵化温度自动计算 + 批量产蛋 ===== */
  const motherId = await p.eval(`(async () => { const m = await import('./js/store.js'); const a = m.S.animal.find(x => x.sex === 'female' && !x.isArchived); return a ? a.id : ''; })()`, { awaitPromise: true });
  ok('存在母本用于产蛋测试', !!motherId, motherId);
  const eggsBefore = await p.eval(`(async () => { const m = await import('./js/store.js'); return m.S.egg.length; })()`, { awaitPromise: true });
  await p.goto(BASE + '#/eggs', 900);
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  // 两步流程：先选物种（v1.3 起），选母本所属物种
  await p.waitFor(`document.querySelector('.modal .pick-row')`, 3000);
  const pickedSp = await p.eval(`(async () => { const m = await import('./js/store.js'); const a = m.S.animal.find(x => x.id === '${motherId}'); const rows = [...document.querySelectorAll('.modal .pick-row')]; const row = rows.find((r) => r.dataset.id === a.speciesId) || rows[0]; row.click(); return row.dataset.id; })()`, { awaitPromise: true });
  ok('产蛋流程先按物种筛选', pickedSp === (await p.eval(`(async () => { const m = await import('./js/store.js'); return m.S.animal.find(x => x.id === '${motherId}').speciesId; })()`, { awaitPromise: true })), pickedSp);
  await p.waitFor(`document.querySelector('.modal #eg-temp')`, 2000);
  ok('产蛋弹窗含孵化温度与产蛋数输入', await p.eval(`!!document.querySelector('.modal #eg-temp') && !!document.querySelector('.modal #eg-count')`), '');
  await p.eval(`document.getElementById('eg-mother').value = '${motherId}'`, { awaitPromise: false });
  const lay0 = await p.eval(`document.getElementById('eg-lay').value`);
  // 22℃ → +90 天
  await p.eval(`document.getElementById('eg-temp').value = '22'; document.getElementById('eg-temp').dispatchEvent(new Event('input'))`, { awaitPromise: false });
  const h22 = await p.eval(`document.getElementById('eg-hatch').value`);
  ok('22℃ 自动计算预计破壳（+90天）', h22 === addDaysStr(lay0, 90), `${lay0} → ${h22}`);
  // 23℃ → +80 天
  await p.eval(`document.getElementById('eg-temp').value = '23'; document.getElementById('eg-temp').dispatchEvent(new Event('input'))`, { awaitPromise: false });
  const h23 = await p.eval(`document.getElementById('eg-hatch').value`);
  ok('23℃ 自动计算预计破壳（+80天）', h23 === addDaysStr(lay0, 80), `${lay0} → ${h23}`);
  // 24℃ → +70 天
  await p.eval(`document.getElementById('eg-temp').value = '24'; document.getElementById('eg-temp').dispatchEvent(new Event('input'))`, { awaitPromise: false });
  const h24 = await p.eval(`document.getElementById('eg-hatch').value`);
  ok('24℃ 自动计算预计破壳（+70天）', h24 === addDaysStr(lay0, 70), `${lay0} → ${h24}`);
  // 25℃ → +60 天
  await p.eval(`document.getElementById('eg-temp').value = '25'; document.getElementById('eg-temp').dispatchEvent(new Event('input'))`, { awaitPromise: false });
  const h25 = await p.eval(`document.getElementById('eg-hatch').value`);
  ok('25℃ 自动计算预计破壳（+60天）', h25 === addDaysStr(lay0, 60), `${lay0} → ${h25}`);
  // 26℃ → 不自动计算（保持 25℃ 的结果，交手动）
  await p.eval(`document.getElementById('eg-temp').value = '26'; document.getElementById('eg-temp').dispatchEvent(new Event('input'))`, { awaitPromise: false });
  const h26 = await p.eval(`document.getElementById('eg-hatch').value`);
  ok('26℃ 不自动计算（保留原值手动填）', h26 === h25, `${h26}`);
  // 批量 3 颗（23℃）
  await p.eval(`document.getElementById('eg-temp').value = '23'; document.getElementById('eg-temp').dispatchEvent(new Event('input')); document.getElementById('eg-count').value = '3'; document.querySelector('.modal .m-foot .btn:not(.ghost)').click()`, { awaitPromise: false });
  await wait(p, 900);
  const batch = await p.eval(`(async () => {
    const m = await import('./js/store.js');
    const mine = m.S.egg.filter(e => e.motherId === '${motherId}' && e.layDate === '${lay0}');
    return { n: mine.length, codes: mine.map(e => e.code), temp: mine[0] ? mine[0].temp : null, hatch: mine[0] ? mine[0].expectHatchDate : '' };
  })()`, { awaitPromise: true });
  ok('按产蛋数批量生成 3 条蛋记录', batch.n === 3, JSON.stringify(batch));
  ok('蛋编号含父母基因缩写且顺序不重复', batch.codes.length === 3 && batch.codes.every(c => c.includes('×') && /\d{3}$/.test(c)) && new Set(batch.codes).size === 3, JSON.stringify(batch.codes));
  ok('蛋记录保存孵化温度与自动破壳日', batch.temp === 23 && batch.hatch === addDaysStr(lay0, 80), JSON.stringify(batch));
  const eggsAfter = await p.eval(`(async () => { const m = await import('./js/store.js'); return m.S.egg.length; })()`, { awaitPromise: true });
  ok('蛋总数 +3', eggsAfter === eggsBefore + 3, `${eggsBefore} → ${eggsAfter}`);
  // 蛋列表/详情展示编号
  const eggListTxt = await p.eval(`document.getElementById('view').textContent`);
  ok('蛋列表展示蛋编号', /×/.test(eggListTxt), eggListTxt.slice(0, 80));
  await p.eval(`(async () => { const m = await import('./js/store.js'); const e = m.S.egg.find(x => x.motherId === '${motherId}' && x.layDate === '${lay0}'); location.hash = '#/egg/' + e.id; })()`, { awaitPromise: false });
  await wait(p, 900);
  const eggDetailTxt = await p.eval(`document.getElementById('view').textContent`);
  ok('蛋详情展示编号与孵化温度', eggDetailTxt.includes('孵化温度') && eggDetailTxt.includes('23'), eggDetailTxt.slice(0, 120));

  /* ===== E. 配对记录自动待办（+20天） ===== */
  const pairRes = await p.eval(`(async () => {
    const m = await import('./js/store.js');
    const u = await import('./js/util.js');
    const male = m.S.animal.find(x => x.name === '${AN1}');
    const female = m.S.animal.find(x => x.sex === 'female' && !x.isArchived);
    const pr = await m.createPairing({ participants: [male.id, female.id], pairDate: '2026-10-01', result: 'pending' });
    const t = m.S.todo.find(x => x.sourceType === 'pairing-check' && x.sourceId === pr.id);
    const before = m.S.todo.length;
    await m.removePairing(pr.id);
    return { todo: t ? { deadline: t.deadline, title: t.title } : null, expect: u.addDays('2026-10-01', 20), afterRemove: m.S.todo.filter(x => x.sourceType === 'pairing-check' && x.sourceId === pr.id).length, beforeN: before };
  })()`, { awaitPromise: true });
  ok('配对自动生成产卵检查待办（日期+20天）', pairRes.todo && pairRes.todo.deadline === pairRes.expect, JSON.stringify(pairRes));
  ok('删除配对后待办同步清除', pairRes.afterRemove === 0, '');

  /* ===== F. 爬柜：文字化 + 容量 + 清理周期 ===== */
  await p.goto(BASE + '#/cages', 900);
  await p.eval(`document.getElementById('btn-new').click()`, { awaitPromise: false });
  await p.waitFor(`document.querySelector('.modal #pl-name')`, 2000);
  const planModal = await p.eval(`document.querySelector('.modal').textContent`);
  ok('新建爬柜含 名称/可放爬箱数/上次清理时间', planModal.includes('方案名称') && planModal.includes('可放爬箱数') && planModal.includes('上次清理时间'), planModal.slice(0, 100));
  await p.eval(`document.getElementById('pl-name').value = '${AN3}'; document.getElementById('pl-cap').value = '2'; document.getElementById('pl-lastclean').value = '2026-10-01'; document.querySelector('.modal .m-foot .btn:not(.ghost)').click()`, { awaitPromise: false });
  await wait(p, 900);
  await p.waitFor(`document.querySelector('#cage-list')`, 2000);
  ok('进入爬柜布局页（文字列表）', await p.eval(`!!document.querySelector('#cage-list') && !document.querySelector('#iso-svg, .iso-host')`), '');
  const capTxt = await p.eval(`document.querySelector('.page-sub').textContent`);
  ok('布局页显示容量与清理周期', capTxt.includes('2 个爬箱') && capTxt.includes('清理周期'), capTxt);
  // 添加 2 个爬箱
  for (let i = 0; i < 2; i++) {
    await p.eval(`document.getElementById('btn-add-cage').click()`, { awaitPromise: false });
    await p.waitFor(`document.querySelector('.modal #cg-zone')`, 2000);
    await p.eval(`document.querySelector('.modal .m-foot .btn:not(.ghost)').click()`, { awaitPromise: false });
    await wait(p, 500);
  }
  const cageCards = await p.eval(`document.querySelectorAll('#cage-list .cage-cell').length`);
  ok('按容量添加 2 个爬箱', cageCards === 2, String(cageCards));
  const capFull = await p.eval(`document.getElementById('cage-list').textContent`);
  ok('达容量上限有提示', capFull.includes('已达该爬柜可放爬箱数上限'), capFull.slice(-60));
  const cageTxt = await p.eval(`document.querySelector('#cage-list .cage-cell').textContent`);
  ok('爬箱文字展示（编号/箱内状态）', cageTxt.includes('爬箱 1') && (cageTxt.includes('空箱') || cageTxt.includes('只')), cageTxt.slice(0, 100));
  // 设置按钮 → 清理周期改「每周」（定位到刚新建的方案卡片）
  await p.goto(BASE + '#/cages', 900);
  await p.eval(`[...document.querySelectorAll('#plan-list .card')].find(c => c.textContent.includes('${AN3}')).querySelector('[data-act="settings"]').click()`, { awaitPromise: false });
  await p.waitFor(`document.querySelector('.modal #st-cycle')`, 2000);
  const cycleOpts = await p.eval(`[...document.querySelectorAll('.modal #st-cycle option')].map(o => o.textContent).join('|')`);
  ok('清理周期四选项（周/月/季/半年）', cycleOpts.includes('每周') && cycleOpts.includes('每月') && cycleOpts.includes('每季') && cycleOpts.includes('每半年'), cycleOpts);
  await p.eval(`document.getElementById('st-cycle').value = 'week'; document.getElementById('st-lastclean').value = '2026-10-01'; document.querySelector('.modal .m-foot .btn:not(.ghost)').click()`, { awaitPromise: false });
  await wait(p, 600);
  const cycleApplied = await p.eval(`(async () => {
    const m = await import('./js/store.js');
    const plan = m.S.cage_plan.find(x => x.name === '${AN3}');
    const cage = m.listCages(plan.id)[0];
    const d = m.cleanDueOf(cage);
    return { cycle: plan.cleanCycle, due: d.due, days: d.days };
  })()`, { awaitPromise: true });
  ok('设置每周后下次清理 = 上次清理+7天', cycleApplied.cycle === 'week' && cycleApplied.due === '2026-10-08', JSON.stringify(cycleApplied));

  /* ===== G. 分享包铲屎官可选 ===== */
  const shareRes = await p.eval(`(async () => {
    const m = await import('./js/store.js');
    const a = m.S.animal.find(x => x.name === '${AN2}');
    const noKeep = m.buildShare(a.id);
    const keep = m.buildShare(a.id, { keepKeeper: true });
    return { noKeep: noKeep.animal.keeper || null, keep: keep.animal.keeper || null };
  })()`, { awaitPromise: true });
  ok('分享包默认不含铲屎官名', shareRes.noKeep === null, JSON.stringify(shareRes));
  ok('分享包可选保留铲屎官名', shareRes.keep === 'V13铲屎官', JSON.stringify(shareRes));
  // 分享页 UI：导出弹窗含铲屎官去留选择
  await p.goto(BASE + '#/share', 900);
  await p.eval(`document.querySelector('[data-exp]').click()`, { awaitPromise: false });
  await p.waitFor(`document.querySelector('.modal #sh-keeper')`, 2000);
  const shOpts = await p.eval(`[...document.querySelectorAll('.modal #sh-keeper option')].map(o => o.textContent).join('|')`);
  ok('分享导出弹窗可选是否保留铲屎官', shOpts.includes('不保留') && shOpts.includes('保留'), shOpts);
  await p.eval(`document.querySelector('.modal .m-close').click()`, { awaitPromise: false });

  /* ===== H. 控制台错误 ===== */
  ok('控制台零错误', p.consoleErrors.length === 0, p.consoleErrors.slice(0, 3).join(' | '));
});

const fail = R.filter(([, c]) => !c);
R.forEach(([n, c, d]) => console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)));
console.log(`汇总: ${R.length - fail.length}/${R.length} 通过`);
process.exit(fail.length ? 1 : 0);
