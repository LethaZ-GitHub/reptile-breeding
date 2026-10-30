// verify-v22.mjs —— v2.2 验证：
//   A. xlsx 引擎往返（全量/部分备份包、基因库、工单；复合基因 comboOf 还原）
//   B. 备份页 UI：导出格式三选一（JSON/Excel/均导出）+ 导入方式（全量/部分）
//   C. 部分 Excel 备份包合并导入（store 级往返）
//   D. 设置页移除「灌入测试数据」（v2.6 起清除入口与测试数据卡片亦删）
//   E. 视图切换按钮在搜索栏右侧、仅图标
//   F. 基因预测弹窗：三列结果（概率/基因性状/基因名称）+ 用户两个示例 + 导出图片
//   G. 蛋详情预测改用新结果表
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const BASE = 'http://127.0.0.1:3226/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2000);
  await seedFixture(p);
  await p.goto(BASE, 2500);

  /* ===== A. xlsx 引擎往返 ===== */
  const rt = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const x = await import('./js/xlsx.js');
    await s.initStore();
    const norm = (v) => JSON.parse(JSON.stringify(v, (k, val) => (val === null || val === undefined) ? '' : val));
    // 全量备份包往返
    const pkg = s.buildBackup({});
    const sheets = s.backupToSheets(pkg);
    const bytes = x.buildXlsx(sheets);
    const parsed = await x.parseXlsx(await new Blob([bytes], { type: x.XLSX_MIME }).arrayBuffer());
    const pkg2 = s.backupFromSheets(parsed.sheets);
    const sameAnimals = JSON.stringify(norm(pkg.tables.animal)) === JSON.stringify(norm(pkg2.tables.animal));
    const sameGenes = JSON.stringify(norm(pkg.tables.gene)) === JSON.stringify(norm(pkg2.tables.gene));
    // 基因库单表往返（重点验 comboOf 数组还原）
    const combo = s.S.gene.find((g) => g.type === 'combo' && (g.comboOf || []).length >= 2);
    let comboRound = 'n/a';
    if (combo) {
      const gb = x.buildXlsx([{ name: '基因库', rows: x.rowsToSheet(s.S.gene) }]);
      const gp = await x.parseXlsx(await new Blob([gb]).arrayBuffer());
      const back = x.sheetToRows(gp.sheets[0].rows);
      comboRound = JSON.stringify(back.find((g) => g.id === combo.id).comboOf) === JSON.stringify(combo.comboOf);
    }
    // 工单单表往返
    const tb = x.buildXlsx([{ name: '工单', rows: x.rowsToSheet(s.S.todo) }]);
    const tp = await x.parseXlsx(await new Blob([tb]).arrayBuffer());
    const todoBack = x.sheetToRows(tp.sheets[0].rows);
    const todoSame = JSON.stringify(norm(s.S.todo)) === JSON.stringify(norm(todoBack));
    return {
      sameAnimals, sameGenes, comboRound, todoSame,
      sheetNames: parsed.sheets.map((sh) => sh.name),
      partial: pkg2.partial, app: pkg2.app,
      todoCount: todoBack.length, srcTodo: s.S.todo.length,
    };
  })()`, { awaitPromise: true });
  ok('全量备份包 Excel 往返：animal 表一致', rt.sameAnimals, JSON.stringify({ n: rt.sheetNames.length }));
  ok('全量备份包 Excel 往返：gene 表一致', rt.sameGenes, '');
  ok('Excel 含 _meta 与全部 13 张表工作表', rt.sheetNames.length === 14 && rt.sheetNames[0] === '_meta' && rt.sheetNames.includes('food') && rt.app === 'reptile-breeding' && rt.partial === false, JSON.stringify(rt.sheetNames));
  ok('基因库 Excel 往返：comboOf 数组完整还原', rt.comboRound === true, String(rt.comboRound));
  ok('工单 Excel 往返：字段一致', rt.todoSame && rt.todoCount === rt.srcTodo, `${rt.todoCount}/${rt.srcTodo}`);

  /* ===== B. 备份页 UI：格式三选一 + 导入方式 ===== */
  await p.goto(BASE + '#/backup', 900);
  await p.eval(`document.getElementById('btn-export').click()`, { awaitPromise: false });
  await wait(p, 400);
  const bkModal = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      modes: [...m.querySelectorAll('#bk-mode .seg-item')].map((x) => x.textContent),
      fmts: [...m.querySelectorAll('#bk-fmt .seg-item')].map((x) => x.textContent),
      hasTables: !!m.querySelector('#bk-tables'),
    };
  })()`);
  ok('备份弹窗含全量/部分模式', bkModal && bkModal.modes.length === 2 && bkModal.modes.includes('全量备份') && bkModal.modes.includes('部分备份'), JSON.stringify(bkModal && bkModal.modes));
  ok('备份弹窗含格式三选一（JSON/Excel/均导出）', bkModal && bkModal.fmts.length === 3 && bkModal.fmts.includes('JSON') && bkModal.fmts.includes('Excel') && bkModal.fmts.includes('均导出'), JSON.stringify(bkModal && bkModal.fmts));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '取消'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);
  await p.eval(`document.getElementById('btn-import').click()`, { awaitPromise: false });
  await wait(p, 400);
  const imModal = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return { modes: [...m.querySelectorAll('#im-mode .seg-item')].map((x) => x.textContent), hint: (m.querySelector('#im-hint') || {}).textContent || '' };
  })()`);
  ok('导入弹窗先选全量/部分', imModal && imModal.modes.length === 2 && imModal.modes.includes('全量导入') && imModal.modes.includes('部分导入'), JSON.stringify(imModal && imModal.modes));
  ok('部分导入说明提及 Excel 支持', imModal && imModal.hint.includes('Excel'), '');
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '取消'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);

  /* ===== C. 部分 Excel 备份包合并导入（store 级） ===== */
  const im = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const x = await import('./js/xlsx.js');
    await s.initStore();
    const a = await s.createAnimal({ name: 'XLSX合并${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [], geneState: 'n' });
    const pkg = s.buildBackup({ tables: ['animal'] });
    const bytes = x.buildXlsx(s.backupToSheets(pkg));
    const parsed = await x.parseXlsx(await new Blob([bytes], { type: x.XLSX_MIME }).arrayBuffer());
    const pkg2 = s.backupFromSheets(parsed.sheets);
    await s.removeAnimal(a.id);
    const gone = !s.S.animal.some((z) => z.id === a.id);
    await s.importBackup(pkg2);
    const back = s.S.animal.find((z) => z.id === a.id);
    return { gone, back: !!back, name: back && back.name, sex: back && back.sex, partial: pkg2.partial, sheets: parsed.sheets.map((sh) => sh.name) };
  })()`, { awaitPromise: true });
  ok('部分 Excel 备份包含 _meta 与 animal 表', im.sheets.includes('_meta') && im.sheets.includes('animal') && im.partial === true, JSON.stringify(im.sheets));
  ok('部分 Excel 备份删除后可合并导入恢复', im.gone && im.back && im.name === `XLSX合并${T}` && im.sex === 'male', JSON.stringify({ gone: im.gone, name: im.name, sex: im.sex }));

  /* ===== D. 设置页：灌入与清除测试数据入口均已删除（v2.6 整卡移除） ===== */
  await p.goto(BASE + '#/settings', 900);
  const seedUi = await p.eval(`({
    seedBtn: !!document.getElementById('btn-seed-test'),
    clearBtn: !!document.getElementById('btn-clear-test'),
    txt: document.body.textContent,
  })`);
  ok('设置页已移除「灌入测试数据」按钮', seedUi.seedBtn === false, '');
  ok('设置页已移除「清除测试数据」按钮', seedUi.clearBtn === false, '');
  ok('设置页无「测试数据」卡片文案', !seedUi.txt.includes('测试数据'), '');
  ok('设置页无「报表统计」卡片文案', !seedUi.txt.includes('报表统计'), '');

  /* ===== E. 视图切换按钮：搜索栏右侧、仅图标 ===== */
  // 注意：localStorage 会持久化视图模式（rb-animal-view），模块加载时读取，
  // 初始可能是 grid 也可能是 list。这里不依赖初始态 —— 先归一化到「列表」态，
  // 再点一次切到「小图标」态，验证图标反转与网格渲染。
  await p.goto(BASE + '#/animals', 900);
  // 前段 importBackup 会替换数据，这里补一只个体保证列表非空
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const has = s.listAnimals({ status: 'active' }).length;
    if (!has) await s.createAnimal({ name: '视图测${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [], geneState: 'n' });
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/home', 500);
  await p.goto(BASE + '#/animals', 900);
  const viewBtn = await p.eval(`(() => {
    const b = document.querySelector('.search-box #btn-view');
    const head = [...document.querySelectorAll('.page-head .btn')].map((x) => x.textContent);
    return b ? { inSearch: true, text: b.textContent, title: b.title, headBtns: head } : { inSearch: false, headBtns: head };
  })()`);
  ok('视图切换按钮位于搜索栏内', viewBtn.inSearch === true, JSON.stringify(viewBtn.headBtns));
  ok('视图按钮仅图标（无文字）', /^[📋🔲]$/u.test(viewBtn.text), viewBtn.text);
  ok('页头不再放置视图切换按钮', !viewBtn.headBtns.some((t) => t.includes('小图标')), JSON.stringify(viewBtn.headBtns));

  // 归一化到「列表」态（图标 🔲 = 当前是列表视图）
  let listIcon = '';
  for (let i = 0; i < 4; i++) {
    listIcon = await p.eval(`document.querySelector('.search-box #btn-view')?.textContent || ''`);
    if (listIcon === '🔲') break;
    await p.eval(`document.querySelector('.search-box #btn-view').click()`, { awaitPromise: false });
    await wait(p, 300);
  }
  // 点一次 → 应切到小图标网格（图标 📋）
  await p.eval(`document.querySelector('.search-box #btn-view').click()`, { awaitPromise: false });
  let gridState = { hasGrid: false, icon: '' };
  for (let i = 0; i < 20; i++) {
    await wait(p, 150);
    gridState = await p.eval(`({ hasGrid: !!document.querySelector('.animal-grid'), icon: document.querySelector('.search-box #btn-view').textContent })`);
    if (gridState.hasGrid) break;
  }
  ok('点击切换小图标网格且图标反转', gridState.hasGrid === true && gridState.icon === '📋' && listIcon === '🔲', JSON.stringify({ listIcon, ...gridState }));

  /* ===== F. 基因预测弹窗：三列结果 + 用户示例 ===== */
  await p.goto(BASE + '#/predict', 1000);
  const pickGene = async (side, namePrefix) => {
    await p.eval(`(() => {
      const box = document.getElementById('${side}-box');
      const sel = box.querySelector('.g-sel');
      const opt = [...sel.options].find((o) => o.textContent.startsWith('${namePrefix}（'));
      if (!opt) return;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change'));
    })()`, { awaitPromise: false });
    await wait(p, 250);
  };
  const readResult = () => p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      title: (m.querySelector('.m-title') || {}).textContent || '',
      ths: [...m.querySelectorAll('.gp-table th')].map((x) => x.textContent),
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
      hasImg: !!m.querySelector('#gp-img'),
    };
  })()`);

  // 示例 1：父本原色（不选）× 母本莉莉白 → 50% 莉莉白 / 50% 原色
  await pickGene('female', '莉莉白');
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await wait(p, 600);
  const r1 = await readResult();
  ok('预测结果弹窗展示（概率/基因性状/基因名称）', r1 && r1.ths.length === 3 && r1.ths[0] === '概率' && r1.ths[1] === '基因性状' && r1.ths[2] === '基因名称', JSON.stringify(r1 && r1.ths));
  ok('弹窗含导出图片按钮', r1 && r1.hasImg === true, '');
  const rowSet1 = (r1 ? r1.rows : []).map((r) => r[0] + '|' + r[1] + '|' + r[2]);
  ok('示例1：莉莉白×原色 → 50% 莉莉白(莉莉白) / 50% 原色(原色)',
    rowSet1.includes('50%|莉莉白|莉莉白') && rowSet1.includes('50%|原色|原色'), JSON.stringify(rowSet1));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);

  // 示例 1b：显式选「原色」= 野生型，结果与不选一致
  await pickGene('male', '原色');
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await wait(p, 600);
  const r1b = await readResult();
  const rowSet1b = (r1b ? r1b.rows : []).map((r) => r[0] + '|' + r[1] + '|' + r[2]);
  ok('示例1b：显式选原色 → 50% 莉莉白 / 50% 原色（同不选）',
    rowSet1b.includes('50%|莉莉白|莉莉白') && rowSet1b.includes('50%|原色|原色'), JSON.stringify(rowSet1b));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);

  // 示例 1c：双方均为原色 → 100% 原色
  await pickGene('female', '原色');
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await wait(p, 600);
  const r1c = await readResult();
  const rowSet1c = (r1c ? r1c.rows : []).map((r) => r[0] + '|' + r[1] + '|' + r[2]);
  ok('示例1c：双方均原色 → 100% 原色', rowSet1c.includes('100%|原色|原色'), JSON.stringify(rowSet1c));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);

  // 示例 2：父本缺黄 × 母本莉莉白 → 50% 莉莉白+缺黄(莉莉白+隐缺黄) / 50% 缺黄(隐缺黄)（v2.4：缺黄仅携带不显现加「隐」）
  await pickGene('female', '莉莉白');
  await pickGene('male', '缺黄');
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await wait(p, 600);
  const r2 = await readResult();
  const comboRow2 = (r2 ? r2.rows : []).find((r) => r[1] === '莉莉白+缺黄');
  const plainRow2 = (r2 ? r2.rows : []).find((r) => r[1] === '缺黄');
  ok('示例2：缺黄×莉莉白 → 50% 莉莉白+缺黄(莉莉白+隐缺黄) / 50% 缺黄(隐缺黄)',
    !!comboRow2 && comboRow2[0] === '50%' && comboRow2[2] === '莉莉白+隐缺黄' && !!plainRow2 && plainRow2[0] === '50%' && plainRow2[2] === '隐缺黄',
    JSON.stringify(r2 && r2.rows));
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal .m-foot .btn')].find((x) => x.textContent === '关闭'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);
  const noInline = await p.eval(`!document.querySelector('#result-box')`);
  ok('预测页不再内联展示结果（仅弹窗）', noInline === true, '');

  /* ===== G. 蛋详情预测改用新结果表 ===== */
  const eggInfo = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const lw = s.listGenes('sp-crested').find((g) => g.name === '莉莉白');
    const ax = s.listGenes('sp-crested').find((g) => g.name === '缺黄');
    const mother = await s.createAnimal({ name: '蛋测母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [lw.id], geneState: 'h' });
    const father = await s.createAnimal({ name: '蛋测父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [ax.id], geneState: 'v' });
    const egg = await s.createEgg({ motherId: mother.id, fatherId: father.id, speciesId: 'sp-crested', status: 'fertile', layDate: '2026-10-12', expectHatchDate: '2026-12-20' });
    return { eggId: egg.id };
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + eggInfo.eggId, 1000);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 600);
  const eggRes = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const rows = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { title: (m.querySelector('.m-title') || {}).textContent || '', ths: [...m.querySelectorAll('.gp-table th')].map((x) => x.textContent), rows, hasImg: !!m.querySelector('#gp-img') };
  })()`);
  ok('蛋详情预测用新三列结果表', eggRes && eggRes.ths.length === 3 && eggRes.hasImg === true, JSON.stringify(eggRes && eggRes.ths));
  const eggCombo = (eggRes ? eggRes.rows : []).find((r) => r[1] === '莉莉白+缺黄');
  const eggPlain = (eggRes ? eggRes.rows : []).find((r) => r[1] === '缺黄');
  ok('蛋详情：缺黄父×莉莉白母 → 莉莉白+隐缺黄 50% / 隐缺黄 50%（v2.4 缺黄仅携带加「隐」）',
    !!eggCombo && eggCombo[0] === '50%' && eggCombo[2] === '莉莉白+隐缺黄' && !!eggPlain && eggPlain[0] === '50%' && eggPlain[2] === '隐缺黄',
    JSON.stringify(eggRes && eggRes.rows));

  console.log('===== 汇总: ' + R.filter((x) => x[1]).length + '/' + R.length + ' 通过 =====');
  const fails = R.filter((x) => !x[1]);
  if (fails.length) { console.log('失败项:'); fails.forEach((f) => console.log('  ❌ ' + f[0] + ' — ' + f[2])); }
  console.log('CONSOLE-ERRORS: ' + JSON.stringify(p.consoleErrors || []));
  process.exit(fails.length ? 1 : 0);
});
