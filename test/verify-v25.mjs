// verify-v25.mjs —— v2.5 验证：
//   A. 内置基因不允许修改/删除（store 守卫 + 基因库页按钮缺失）；自定义基因仍可编辑/删除
//   B. 基因库列表不显示英文列；点击基因（行/详情按钮）弹出详情弹窗（英文名/遗传/物种/来源/被引用/组分/说明）
//   C. 预测结果逐段着色：莉莉白+隐缺黄 仅「隐缺黄」段标蓝；超级莉莉白+缺黄 仅「超级莉莉白」段标红
//   D. 基因性状列超级体为表达式（莉莉白+莉莉白）
//   E. 复合基因拆开参与计算 + 性状列拆分表现（缺黄莉莉×缺黄莉莉 → 缺黄+莉莉白 / 名称 缺黄莉莉）
//   F. 导出 SVG 逐段 tspan 着色；蛋详情预测同规则
import { withBrowser } from './cdp.mjs';

const BASE = 'http://127.0.0.1:3229/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2500);

  /* ===== A. 内置基因禁改禁删 / 自定义可改可删 ===== */
  const guard = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const builtin = s.listGenes('sp-crested').find((g) => g.name === '莉莉白');
    let updErr = '', delErr = '';
    try { await s.updateGene(builtin.id, { desc: '试图篡改' }); } catch (e) { updErr = e.message; }
    try { await s.removeGene(builtin.id); } catch (e) { delErr = e.message; }
    const stillThere = !!s.listGenes('sp-crested').find((g) => g.id === builtin.id);
    const descKept = (s.listGenes('sp-crested').find((g) => g.id === builtin.id) || {}).desc !== '试图篡改';
    const custom = await s.createGene({ speciesId: 'sp-crested', name: 'V25自定义${T}', type: 'recessive', desc: '初版说明' });
    await s.updateGene(custom.id, { desc: '改过的说明' });
    const descOk = (s.listGenes('sp-crested').find((g) => g.id === custom.id) || {}).desc === '改过的说明';
    await s.removeGene(custom.id);
    const gone = !s.listGenes('sp-crested').some((g) => g.id === custom.id);
    return { updErr, delErr, stillThere, descKept, descOk, gone };
  })()`, { awaitPromise: true });
  ok('store：内置基因不可修改（updateGene 抛错且数据不动）',
    /内置基因不可修改/.test(guard.updErr) && guard.stillThere && guard.descKept, JSON.stringify(guard.updErr));
  ok('store：内置基因不可删除（removeGene 抛错）',
    /内置基因不可删除/.test(guard.delErr) && guard.stillThere, JSON.stringify(guard.delErr));
  ok('store：自定义基因可修改/删除', guard.descOk === true && guard.gone === true, JSON.stringify({ descOk: guard.descOk, gone: guard.gone }));

  /* ===== B. 基因库页：无英文列 + 详情弹窗 + 内置锁定 ===== */
  await p.goto(BASE + '#/genes', 1200);
  await wait(p, 500);
  const tblHead = await p.eval(`JSON.stringify([...document.querySelectorAll('#gene-tbl thead th')].map((x) => x.textContent.trim()))`);
  ok('基因库列表不再显示英文列（表头无「英文」）',
    tblHead.includes('基因') && tblHead.includes('遗传') && tblHead.includes('物种') && tblHead.includes('来源') && !tblHead.includes('英文'),
    tblHead);
  const bodyEn = await p.eval(`document.getElementById('gene-tbl').innerText.includes('Lilly White')`);
  ok('基因库列表不展示英文名（Lilly White 不在表格）', bodyEn === false, String(bodyEn));

  // 造一个自定义基因，便于检查两类行的按钮差异
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.createGene({ speciesId: 'sp-crested', name: 'V25自定义基因${T}', en: 'V25CustomEn', type: 'recessive', desc: 'v2.5 自定义详情测试' });
  })()`, { awaitPromise: true });
  // 注意：hash 导航不会重渲染页面，必须整页 reload 后再进 #/genes
  await p.goto(BASE, 1200);
  await p.eval(`location.hash = '#/genes'`, { awaitPromise: false });
  await wait(p, 700);
  const btnState = await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#gene-tbl tbody tr')];
    const pick = (name) => rows.find((tr) => (tr.children[0] || {}).textContent.trim() === name) || null;
    const btns = (tr) => tr ? [...tr.querySelectorAll('button')].map((b) => b.textContent.trim()) : null;
    return { builtin: btns(pick('莉莉白')), custom: btns(pick('V25自定义基因${T}')) };
  })()`);
  ok('内置基因行无编辑/删除按钮（仅详情）',
    !!btnState.builtin && btnState.builtin.includes('详情') && !btnState.builtin.includes('编辑') && !btnState.builtin.includes('删除'),
    JSON.stringify(btnState.builtin));
  ok('自定义基因行保留详情/编辑/删除按钮',
    !!btnState.custom && btnState.custom.includes('详情') && btnState.custom.includes('编辑') && btnState.custom.includes('删除'),
    JSON.stringify(btnState.custom));

  // 点击内置基因行（名称单元格，非按钮区）→ 详情弹窗
  await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#gene-tbl tbody tr')];
    const tr = rows.find((t) => (t.children[0] || {}).textContent.trim() === '莉莉白');
    if (tr) tr.children[0].click();
  })()`, { awaitPromise: false });
  await wait(p, 500);
  const det = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      title: (m.querySelector('.m-title') || {}).textContent || '',
      txt: m.innerText.replace(/\\s+/g, ' '),
      btns: [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent.trim()),
    };
  })()`);
  ok('点击基因弹出详情弹窗（标题/英文名/遗传方式/来源/被引用齐全）',
    !!det && det.title.includes('基因详情') && det.txt.includes('英文名') && det.txt.includes('Lilly White')
      && det.txt.includes('不完全显性') && det.txt.includes('内置') && det.txt.includes('被引用'),
    det && det.txt.slice(0, 260));
  ok('内置基因详情弹窗仅「关闭」（无编辑/删除）并提示不可修改',
    !!det && det.btns.length === 1 && det.btns[0] === '关闭' && det.txt.includes('不可修改'),
    JSON.stringify(det && det.btns));
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await wait(p, 250);

  // 「详情」按钮同样弹窗；复合基因详情展示组分
  await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#gene-tbl tbody tr')];
    const tr = rows.find((t) => (t.children[0] || {}).textContent.trim() === '缺黄莉莉');
    if (tr) tr.querySelector('[data-detail]').click();
  })()`, { awaitPromise: false });
  await wait(p, 500);
  const detCombo = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return { txt: m.innerText.replace(/\\s+/g, ' '), hasComp: m.innerText.includes('复合组分'), hasSplit: m.innerText.includes('缺黄 + 莉莉白') };
  })()`);
  ok('复合基因详情展示组分（缺黄 + 莉莉白）',
    !!detCombo && detCombo.hasComp && detCombo.hasSplit, detCombo && detCombo.txt.slice(0, 200));
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await wait(p, 250);

  // 自定义基因详情弹窗含编辑/删除
  await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#gene-tbl tbody tr')];
    const tr = rows.find((t) => (t.children[0] || {}).textContent.trim() === 'V25自定义基因${T}');
    if (tr) tr.children[0].click();
  })()`, { awaitPromise: false });
  await wait(p, 500);
  const detCustom = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return { btns: [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent.trim()), txt: m.innerText.replace(/\\s+/g, ' ') };
  })()`);
  ok('自定义基因详情弹窗含编辑/删除按钮且展示英文名',
    !!detCustom && detCustom.btns.includes('编辑') && detCustom.btns.includes('删除') && detCustom.txt.includes('V25CustomEn'),
    JSON.stringify(detCustom && detCustom.btns));
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await wait(p, 250);

  /* ===== C~E. 引擎层：逐段着色数据 / 超级体表达式 / 复合拆分 ===== */
  const eng = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const g = await import('./js/genetics.js');
    await s.initStore();
    const pool = s.listGenes('sp-crested');
    // 场景1：莉莉白(单拷贝双方) × 缺黄(纯合) —— 超级体 + 可见隐性 → 复合名匹配
    // （入参顺序即展示顺序：看得到的基因在前）
    const r1 = g.predictOutcomes([
      { name: '莉莉白', type: 'incomplete', male: 'h', female: 'h' },
      { name: '缺黄', type: 'recessive', male: 'v', female: 'v' },
    ], pool);
    const superRow = r1.rows.find((r) => r.phenotype === '莉莉白+莉莉白+缺黄') || null;
    const comboRow = r1.rows.find((r) => r.phenotype === '莉莉白+缺黄') || null;
    const plainRow = r1.rows.find((r) => r.phenotype === '缺黄') || null;
    // 场景2：莉莉白(单拷贝母方) × 缺黄(纯合父方) —— 隐携带混合段
    const r2 = g.predictOutcomes([
      { name: '莉莉白', type: 'incomplete', male: 'n', female: 'h' },
      { name: '缺黄', type: 'recessive', male: 'v', female: 'n' },
    ], pool);
    const hiddenRow = r2.rows.find((r) => r.phenotype === '莉莉白+缺黄') || null;
    const hiddenOnly = r2.rows.find((r) => r.phenotype === '缺黄') || null;
    return {
      r1: r1.rows.map((r) => [r.probText, r.phenotype, r.name, !!r.combo]),
      superRow: superRow && { name: superRow.name, parts: superRow.nameParts },
      comboRow: comboRow && { name: comboRow.name, combo: comboRow.combo },
      plainRow: plainRow && plainRow.name,
      hiddenRow: hiddenRow && { name: hiddenRow.name, parts: hiddenRow.nameParts },
      hiddenOnly: hiddenOnly && { name: hiddenOnly.name, parts: hiddenOnly.nameParts },
    };
  })()`, { awaitPromise: true });
  ok('超级体性状为表达式：莉莉白+莉莉白+缺黄（名称 超级莉莉白+缺黄）',
    !!eng.superRow && eng.superRow.name === '超级莉莉白+缺黄'
      && eng.r1.some((r) => r[0] === '25%' && r[1] === '莉莉白+莉莉白+缺黄' && r[2] === '超级莉莉白+缺黄'),
    JSON.stringify(eng.r1));
  ok('复合基因拆开计算：性状列为 莉莉白+缺黄（拆分表现），名称取登记名 缺黄莉莉',
    !!eng.comboRow && eng.comboRow.name === '缺黄莉莉' && eng.comboRow.combo === true
      && eng.r1.some((r) => r[0] === '50%' && r[1] === '莉莉白+缺黄' && r[2] === '缺黄莉莉' && r[3] === true),
    JSON.stringify(eng.r1));
  ok('复合场景其余行：25% 缺黄/缺黄（无超级无隐）',
    eng.plainRow === '缺黄' && eng.r1.some((r) => r[0] === '25%' && r[1] === '缺黄' && r[2] === '缺黄'),
    JSON.stringify(eng.r1));
  ok('逐段着色数据：超级莉莉白+缺黄 → 仅首段 super，缺黄段无色',
    !!eng.superRow && eng.superRow.parts.length === 2
      && eng.superRow.parts[0].t === '超级莉莉白' && eng.superRow.parts[0].c === 'super'
      && eng.superRow.parts[1].t === '缺黄' && eng.superRow.parts[1].c === '',
    JSON.stringify(eng.superRow));
  ok('逐段着色数据：莉莉白+隐缺黄 → 仅「隐缺黄」段 hidden，莉莉白段无色',
    !!eng.hiddenRow && eng.hiddenRow.name === '莉莉白+隐缺黄'
      && eng.hiddenRow.parts.length === 2
      && eng.hiddenRow.parts[0].t === '莉莉白' && eng.hiddenRow.parts[0].c === ''
      && eng.hiddenRow.parts[1].t === '隐缺黄' && eng.hiddenRow.parts[1].c === 'hidden',
    JSON.stringify(eng.hiddenRow));
  ok('逐段着色数据：单段隐缺黄整段 hidden',
    !!eng.hiddenOnly && eng.hiddenOnly.name === '隐缺黄'
      && eng.hiddenOnly.parts.length === 1 && eng.hiddenOnly.parts[0].c === 'hidden',
    JSON.stringify(eng.hiddenOnly));

  /* ===== C~E. 页面层：预测结果弹窗 ===== */
  await p.goto(BASE + '#/predict', 900);
  await wait(p, 500);
  const pickGene = async (side, namePrefix) => {
    await p.eval(`(() => {
      const box = document.getElementById('${side}-box');
      const sel = box.querySelector('.g-sel');
      const opt = [...sel.options].find((o) => o.textContent.startsWith('${namePrefix}'));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
    })()`, { awaitPromise: false });
    await wait(p, 250);
  };
  const closeModals = async () => {
    await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
    await wait(p, 250);
  };
  const run = async () => {
    await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
    await wait(p, 700);
  };
  const nameCellHtml = (nameText) => p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const trs = [...m.querySelectorAll('.gp-table tbody tr')];
    // 名称列 textContent 可能含「复合」徽章文字，匹配时剥掉
    const tr = trs.find((t) => {
      const td = t.querySelectorAll('td')[2];
      return td && td.textContent.trim().replace('复合', '') === '${nameText}';
    });
    if (!tr) return null;
    const td = tr.querySelectorAll('td')[2];
    const html = td.innerHTML;
    // v3.3：基因名改为可点击链接（<a class="gp-name-link">），着色 span 仍在其中。
    // 为比对「逐段着色」结构，剥掉 a 包装后比较。
    const htmlNoLink = html.replace(/<a\\b[^>]*>/g, '').replace(/<\\/a>/g, '');
    return { html, htmlNoLink, badge: html.includes('复合') };
  })()`);

  // C1. 缺黄 × 莉莉白 → 莉莉白+隐缺黄：仅隐缺黄段蓝
  await pickGene('male', '缺黄');
  await pickGene('female', '莉莉白');
  await run();
  const segHidden = await nameCellHtml('莉莉白+隐缺黄');
  ok('页面：「莉莉白+隐缺黄」仅「隐缺黄」段标蓝（莉莉白段不着色）',
    !!segHidden && segHidden.htmlNoLink === '莉莉白+<span style="color:#1a6fd4">隐缺黄</span>',
    segHidden && segHidden.html);
  await closeModals();

  // C2 + D + E. 缺黄莉莉 × 缺黄莉莉 → 超级段红 / 复合徽章 / 表达式
  await pickGene('male', '缺黄莉莉');
  await pickGene('female', '缺黄莉莉');
  await run();
  const modalRows = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      txt: m.innerText.replace(/\\s+/g, ' '),
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim().replace('复合', ''))),
    };
  })()`);
  ok('复合基因×复合基因：25% 缺黄+莉莉白+莉莉白 / 50% 缺黄+莉莉白(缺黄莉莉) / 25% 缺黄',
    !!modalRows && modalRows.rows.some((r) => r[0] === '25%' && r[1] === '缺黄+莉莉白+莉莉白' && r[2] === '缺黄+超级莉莉白')
      && modalRows.rows.some((r) => r[0] === '50%' && r[1] === '缺黄+莉莉白' && r[2] === '缺黄莉莉')
      && modalRows.rows.some((r) => r[0] === '25%' && r[1] === '缺黄' && r[2] === '缺黄'),
    JSON.stringify(modalRows && modalRows.rows));
  const segSuper = await nameCellHtml('缺黄+超级莉莉白');
  ok('页面：「缺黄+超级莉莉白」仅「超级莉莉白」段标红（缺黄段不着色）',
    !!segSuper && segSuper.htmlNoLink === '缺黄+<span style="color:#d92626;font-weight:700">超级莉莉白</span>',
    segSuper && segSuper.html);
  const segCombo = await nameCellHtml('缺黄莉莉');
  ok('页面：复合基因行名称带「复合」徽章', !!segCombo && segCombo.badge === true, segCombo && segCombo.html);
  ok('超级体健康风险提示仍在', !!modalRows && modalRows.txt.includes('健康风险'), modalRows && modalRows.txt.slice(0, 160));
  await closeModals();

  /* ===== F. SVG 逐段 tspan + 蛋详情同规则 ===== */
  const svgCheck = await p.eval(`(async () => {
    const ui = await import('./js/ui.js');
    const g = await import('./js/genetics.js');
    const sup = g.predictOutcomes([
      { name: '缺黄', type: 'recessive', male: 'v', female: 'v' },
      { name: '莉莉白', type: 'incomplete', male: 'h', female: 'h' },
    ], []);
    const hid = g.predictOutcomes([
      { name: '缺黄', type: 'recessive', male: 'v', female: 'n' },
      { name: '莉莉白', type: 'incomplete', male: 'n', female: 'h' },
    ], []);
    return {
      red: ui.outcomeSvg(sup, { title: 't' }).includes('<tspan fill="#d92626" font-weight="700">超级莉莉白</tspan>'),
      blue: ui.outcomeSvg(hid, { title: 't' }).includes('<tspan fill="#1a6fd4">隐缺黄</tspan>'),
      green: ui.outcomeSvg(hid, { title: 't' }).includes('<tspan fill="#1e7a50">莉莉白</tspan>'),
    };
  })()`, { awaitPromise: true });
  ok('导出 SVG 逐段 tspan 着色（超级段红/隐段蓝/普通段原色）',
    svgCheck.red === true && svgCheck.blue === true && svgCheck.green === true, JSON.stringify(svgCheck));

  const eggId = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const ax = s.listGenes('sp-crested').find((g) => g.name === '缺黄');
    const lw = s.listGenes('sp-crested').find((g) => g.name === '莉莉白');
    const mother = await s.createAnimal({ name: 'V25母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [ax.id], geneState: 'h' });
    const father = await s.createAnimal({ name: 'V25父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [lw.id], geneState: 'v' });
    const egg = await s.createEgg({ motherId: mother.id, fatherId: father.id, speciesId: 'sp-crested', status: 'fertile', layDate: u.todayStr() });
    return egg.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + eggId, 1200);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 600);
  const eggSeg = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const trs = [...m.querySelectorAll('.gp-table tbody tr')];
    const tr = trs.find((t) => (t.querySelectorAll('td')[2] || {}).textContent.trim() === '莉莉白+隐缺黄');
    return tr ? tr.querySelectorAll('td')[2].innerHTML : null;
  })()`);
  ok('蛋详情预测同样逐段着色（仅隐缺黄段蓝）',
    eggSeg === '莉莉白+<span style="color:#1a6fd4">隐缺黄</span>', String(eggSeg));

  /* ===== 汇总 ===== */
  const pass = R.filter(([, c]) => c).length;
  console.log(`\n===== v2.5 验证结果：${pass}/${R.length} 通过 =====`);
  const fails = R.filter(([, c]) => !c);
  if (fails.length) { console.log('失败项：'); fails.forEach(([n]) => console.log('  ❌ ' + n)); process.exitCode = 1; }
  console.log('CONSOLE-ERRORS:', JSON.stringify(p.consoleErrors));
});
