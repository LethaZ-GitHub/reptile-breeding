// verify-v24.mjs —— v2.4 验证：
//   A. 紫貂改为不完全显性，且内置基因库强制覆盖存量数据（syncBuiltinGenes 全字段覆盖，自定义基因不动）
//   B. 预测页「开始预测」旁新增基因互换按钮（互换公母所选基因，含单边/连点两次）
//   C. 隐性基因仅携带不显现 → 基因名称加「隐」前缀（原色×缺黄 → 隐缺黄；缺黄×莉莉白 → 莉莉白+隐缺黄）
//   D. 超级体名称标红、隐携带标蓝（结果表 + 导出 SVG）
//   E. 蛋详情预测同引擎生效（隐前缀 + 标蓝）
import { withBrowser } from './cdp.mjs';

const BASE = 'http://127.0.0.1:3228/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2500);

  /* ===== A. 紫貂改为不完全显性 + 基因库强制覆盖 ===== */
  const seedSable = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const sab = s.listGenes('sp-crested').find((g) => g.name === '紫貂');
    return sab ? { id: sab.id, type: sab.type, isCustom: !!sab.isCustom } : null;
  })()`, { awaitPromise: true });
  ok('内置基因库：紫貂为不完全显性（v2.4）', !!seedSable && seedSable.type === 'incomplete', JSON.stringify(seedSable));

  // 模拟存量：把内置紫貂改成旧版显性 + 改名 + 改组分（用户改动/旧数据），启动同步后应被种子覆盖
  const syncRes = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    await s.initStore();
    const sab = s.listGenes('sp-crested').find((g) => g.name === '紫貂');
    sab.type = 'dominant'; sab.name = '紫貂旧名'; sab.desc = '旧描述'; sab.comboOf = ['缺黄'];
    await db.dbPut('gene', sab);
    const custom = { id: 'g-custom-v24-' + '${T}', name: 'V24自定义基因${T}', en: 'V24Custom', type: 'recessive', desc: '自定义', comboOf: [], isCustom: true, speciesId: 'sp-crested', createdAt: new Date().toISOString() };
    await db.dbPut('gene', custom);
    const r = await s.syncBuiltinGenes();
    await s.reload();
    const after = s.listGenes('sp-crested').find((g) => g.id === '${seedSable.id}');
    const customAfter = s.listGenes('sp-crested').find((g) => g.id === custom.id);
    return { r, after: after && { name: after.name, type: after.type }, customKept: !!customAfter };
  })()`, { awaitPromise: true });
  ok('本次更新覆盖用户原有基因库（内置紫貂被种子覆盖回不完全显性/原名）',
    !!syncRes && syncRes.r.updated >= 1 && syncRes.after && syncRes.after.type === 'incomplete' && syncRes.after.name === '紫貂',
    JSON.stringify(syncRes));
  ok('用户自定义基因不被覆盖', !!syncRes && syncRes.customKept === true, JSON.stringify(syncRes && syncRes.customKept));

  /* ===== B~E. 基因预测 ===== */
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
  const selInfo = () => p.eval(`(() => ({
    male: document.querySelector('#male-box .g-sel').value,
    female: document.querySelector('#female-box .g-sel').value,
    maleText: (document.querySelector('#male-box .g-sel').selectedOptions[0] || {}).textContent || '',
    femaleText: (document.querySelector('#female-box .g-sel').selectedOptions[0] || {}).textContent || '',
  }))()`);
  const readModal = () => p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const rows = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    const styles = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => {
      const sp = tr.querySelectorAll('td')[2] ? tr.querySelectorAll('td')[2].querySelector('span') : null;
      return sp ? sp.style.color : '';
    });
    return { rows, styles, txt: m.innerText.replace(/\\s+/g, ' '), warn: !!m.querySelector('.warn-box'), hasImg: !!m.querySelector('#gp-img') };
  })()`);
  const closeModals = async () => {
    await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
    await wait(p, 250);
  };
  const run = async () => {
    await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
    await wait(p, 700);
  };

  // B. 互换按钮：存在于开始预测旁边（先轮询等页面渲染完，避免时序竞态）
  await p.eval(`new Promise((res) => { const t0 = Date.now(); (function poll(){ if (document.getElementById('btn-swap') && document.getElementById('btn-run')) return res(1); if (Date.now()-t0 > 8000) return res(0); setTimeout(poll, 150); })(); })`, { awaitPromise: true });
  const swapBtn = await p.eval(`(() => {
    const b = document.getElementById('btn-swap');
    const r = document.getElementById('btn-run');
    return !!b && !!r && b.parentNode === r.parentNode;
  })()`);
  ok('「开始预测」旁存在基因互换按钮', swapBtn === true, String(swapBtn));

  // 公缺黄 × 母莉莉白 → 互换 → 公莉莉白 / 母缺黄
  await pickGene('male', '缺黄');
  await pickGene('female', '莉莉白');
  const before = await selInfo();
  await p.eval(`document.getElementById('btn-swap').click()`, { awaitPromise: false });
  await wait(p, 300);
  const after = await selInfo();
  ok('互换按钮对调公母所选基因',
    before.male !== before.female && after.male === before.female && after.female === before.male
      && after.maleText.startsWith('莉莉白') && after.femaleText.startsWith('缺黄'),
    JSON.stringify({ before, after }));

  // 再点一次互换 → 还原
  await p.eval(`document.getElementById('btn-swap').click()`, { awaitPromise: false });
  await wait(p, 300);
  const back = await selInfo();
  ok('再次互换还原公母选择', back.male === before.male && back.female === before.female, JSON.stringify(back));

  // 单边选择也互换（公卡布奇诺、母空 → 互换后母卡布奇诺、公空）
  await p.eval(`(() => { const s = document.querySelector('#female-box .g-sel'); s.value = ''; s.dispatchEvent(new Event('change')); })()`, { awaitPromise: false });
  await wait(p, 250);
  await pickGene('male', '卡布奇诺');
  await p.eval(`document.getElementById('btn-swap').click()`, { awaitPromise: false });
  await wait(p, 300);
  const half = await selInfo();
  ok('单边选择也可互换（基因移到对面）',
    half.male === '' && half.femaleText.startsWith('卡布奇诺'), JSON.stringify(half));

  // C1. 原色 × 缺黄 → 100% 隐缺黄（蓝）
  await pickGene('male', '原色');
  await pickGene('female', '缺黄');
  await run();
  const m1 = await readModal();
  const hiddenRow = m1 ? m1.rows.find((r) => r[1] === '缺黄') : null;
  const hiddenIdx = m1 ? m1.rows.findIndex((r) => r[1] === '缺黄') : -1;
  ok('原色×缺黄 → 100% 缺黄，基因名称「隐缺黄」',
    !!hiddenRow && hiddenRow[0] === '100%' && hiddenRow[2] === '隐缺黄',
    JSON.stringify(m1 && m1.rows));
  ok('隐携带名称标蓝（#1a6fd4）',
    hiddenIdx >= 0 && m1.styles[hiddenIdx] === 'rgb(26, 111, 212)',
    JSON.stringify(m1 && m1.styles));
  await closeModals();

  // C2. 缺黄 × 莉莉白 → 莉莉白+隐缺黄 / 隐缺黄（复合名不掩盖携带状态）
  await pickGene('male', '缺黄');
  await pickGene('female', '莉莉白');
  await run();
  const m2 = await readModal();
  ok('缺黄×莉莉白 → 50% 莉莉白+隐缺黄 / 50% 隐缺黄',
    !!m2 && m2.rows.some((r) => r[0] === '50%' && r[1] === '莉莉白+缺黄' && r[2] === '莉莉白+隐缺黄')
      && m2.rows.some((r) => r[0] === '50%' && r[1] === '缺黄' && r[2] === '隐缺黄'),
    JSON.stringify(m2 && m2.rows));
  await closeModals();

  // D1. 卡布奇诺 × 卡布奇诺 → 超级卡布奇诺（名称段红；v2.5 性状列为 卡布奇诺+卡布奇诺 表达式）
  await pickGene('male', '卡布奇诺');
  await pickGene('female', '卡布奇诺');
  await run();
  const m3 = await readModal();
  const superIdx = m3 ? m3.rows.findIndex((r) => r[2] === '超级卡布奇诺') : -1;
  ok('卡布奇诺×卡布奇诺 → 25% 超级卡布奇诺 + 健康风险',
    !!m3 && m3.rows.some((r) => r[0] === '25%' && r[1] === '卡布奇诺+卡布奇诺' && r[2] === '超级卡布奇诺') && m3.warn && m3.txt.includes('健康风险'),
    JSON.stringify(m3 && m3.rows));
  ok('超级体名称标红（#d92626）',
    superIdx >= 0 && m3.styles[superIdx] === 'rgb(217, 38, 38)',
    JSON.stringify(m3 && m3.styles));
  await closeModals();

  // D2. 紫貂 × 紫貂（不完全显性）→ 超级紫貂（红）
  await pickGene('male', '紫貂');
  await pickGene('female', '紫貂');
  await run();
  const m4 = await readModal();
  ok('紫貂×紫貂 → 50% 紫貂 / 25% 超级紫貂（性状为 紫貂+紫貂 表达式） / 25% 原色（紫貂按不完全显性计算）',
    !!m4 && m4.rows.some((r) => r[0] === '50%' && r[1] === '紫貂')
      && m4.rows.some((r) => r[0] === '25%' && r[1] === '紫貂+紫貂' && r[2] === '超级紫貂')
      && m4.rows.some((r) => r[0] === '25%' && r[1] === '原色'),
    JSON.stringify(m4 && m4.rows));
  ok('结果说明含「隐」/标蓝/标红图例', !!m4 && m4.txt.includes('隐') && m4.txt.includes('标蓝') && m4.txt.includes('标红'), m4 && m4.txt.slice(0, 300));
  await closeModals();

  // D3. 导出 SVG 的红蓝填充
  const svgCheck = await p.eval(`(async () => {
    const ui = await import('./js/ui.js');
    const g = await import('./js/genetics.js');
    const sup = g.predictOutcomes([{ name: '卡布奇诺', type: 'incomplete', male: 'h', female: 'h' }], []);
    const hid = g.predictOutcomes([{ name: '缺黄', type: 'recessive', female: 'v' }], []);
    return {
      red: ui.outcomeSvg(sup, { title: 't' }).includes('fill="#d92626"'),
      blue: ui.outcomeSvg(hid, { title: 't' }).includes('fill="#1a6fd4"'),
    };
  })()`, { awaitPromise: true });
  ok('导出图片 SVG 同步红蓝着色', svgCheck.red === true && svgCheck.blue === true, JSON.stringify(svgCheck));

  /* ===== E. 蛋详情预测同引擎生效 ===== */
  const eggId = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const ax = s.listGenes('sp-crested').find((g) => g.name === '缺黄');
    const lw = s.listGenes('sp-crested').find((g) => g.name === '莉莉白');
  // v2.6 起个体不登记基因状态：母缺黄（隐性默认纯合 v）× 父莉莉白（不完全显性默认单拷贝 h）
  // 缺黄 locus：母 v × 父 n → 100% 杂合（名称加「隐」）；莉莉白 locus：母 n × 父 h → 50% 单拷贝 / 50% 不携带
  const mother = await s.createAnimal({ name: 'V24母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [ax.id] });
  const father = await s.createAnimal({ name: 'V24父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [lw.id] });
    const egg = await s.createEgg({ motherId: mother.id, fatherId: father.id, speciesId: 'sp-crested', status: 'fertile', layDate: u.todayStr() });
    return egg.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + eggId, 1200);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 600);
  const eggModal = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const rows = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    const styles = [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => {
      const sp = tr.querySelectorAll('td')[2] ? tr.querySelectorAll('td')[2].querySelector('span') : null;
      return sp ? sp.style.color : '';
    });
    return { rows, styles };
  })()`);
  const eggHiddenIdx = eggModal ? eggModal.rows.findIndex((r) => r[1] === '缺黄' && r[2] === '隐缺黄') : -1;
  const eggHiddenIdx2 = eggModal ? eggModal.rows.findIndex((r) => r[1] === '莉莉白+缺黄' && r[2] === '莉莉白+隐缺黄') : -1;
  ok('蛋详情：缺黄母本×莉莉白父本 → 隐缺黄 / 莉莉白+隐缺黄 各 50% 且隐段标蓝',
    !!eggModal && eggModal.rows.length === 2
      && eggModal.rows.some((r) => r[0] === '50%' && r[1] === '缺黄' && r[2] === '隐缺黄')
      && eggModal.rows.some((r) => r[0] === '50%' && r[1] === '莉莉白+缺黄' && r[2] === '莉莉白+隐缺黄')
      && eggHiddenIdx >= 0 && eggModal.styles[eggHiddenIdx] === 'rgb(26, 111, 212)'
      && eggHiddenIdx2 >= 0 && eggModal.styles[eggHiddenIdx2] === 'rgb(26, 111, 212)',
    JSON.stringify(eggModal && eggModal.rows));

  /* ===== 汇总 ===== */
  const pass = R.filter(([, c]) => c).length;
  console.log(`\n===== v2.4 验证结果：${pass}/${R.length} 通过 =====`);
  const fails = R.filter(([, c]) => !c);
  if (fails.length) { console.log('失败项：'); fails.forEach(([n]) => console.log('  ❌ ' + n)); process.exitCode = 1; }
  console.log('CONSOLE-ERRORS:', JSON.stringify(p.consoleErrors));
});
