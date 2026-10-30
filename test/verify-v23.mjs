// verify-v23.mjs —— v2.3 验证：
//   A. 删除数据灌入功能（test-seed 模块移除 / boot 不灌入 / 设置页无灌入入口；v2.6 起清除入口亦删）
//   B. 基因预测删除状态选择（.st-sel 消失）
//   C. 复合基因拆解计算（母 缺黄莉莉 × 父 缺黄卡布 → 组分参与计算 + 复合命名）
//   D. 超级体命名 + 健康风险提示（卡布奇诺 × 卡布奇诺 → 超级卡布奇诺）
//   E. 历史示例回归（莉莉白×原色 50/50；缺黄×莉莉白 → 莉莉白+隐缺黄/隐缺黄，v2.4 起隐前缀）
//   F. 蛋详情预测：无状态选择 + 复合基因拆解说明
//   G. 预测弹窗导出图片按钮仍在
import { withBrowser } from './cdp.mjs';

const BASE = 'http://127.0.0.1:3227/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  // 干净起点：临时 profile 本就是空库空 localStorage
  await p.goto(BASE, 2500);

  /* ===== A. 删除数据灌入功能 ===== */
  const modGone = await p.eval(`(async () => { try { await import('./js/test-seed.js'); return 'present'; } catch (e) { return 'absent'; } })()`, { awaitPromise: true });
  ok('js/test-seed.js 模块已删除', modGone === 'absent', String(modGone));

  // 即使保留旧的 PC 端开关也不再灌入
  await p.eval(`localStorage.setItem('rb-seed-test','1')`, { awaitPromise: false });
  await p.goto(BASE, 2500);
  const noSeed = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    return { test: s.S.animal.filter((a) => (a.name || '').startsWith('[测试]')).length, total: s.S.animal.length };
  })()`, { awaitPromise: true });
  ok('取消灌入：遗留开关也不再产生任何测试数据', noSeed.test === 0 && noSeed.total === 0, JSON.stringify(noSeed));

  // 设置页：测试数据功能整卡移除（v2.6：灌入与清除入口均已删除）
  await p.goto(BASE + '#/settings', 900);
  await wait(p, 400);
  const settingsBtns = await p.eval(`(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()))()`);
  ok('设置页无「灌入测试数据」入口', !settingsBtns.some((t) => t.includes('灌入')), JSON.stringify(settingsBtns.filter((t) => t.includes('试'))));
  const clearBtn = await p.eval(`!!document.getElementById('btn-clear-test')`);
  ok('设置页已移除「清除测试数据」按钮（v2.6 删除测试数据功能）', clearBtn === false, String(clearBtn));
  const setTxt = await p.eval(`document.getElementById('view').textContent`);
  ok('设置页无「测试数据」卡片文案', !setTxt.includes('测试数据'), '');
  ok('设置页无「报表统计」卡片文案', !setTxt.includes('报表统计'), '');

  /* ===== B~G. 基因预测 ===== */
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
  const readModal = () => p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
      txt: m.innerText.replace(/\\s+/g, ' '),
      warn: !!m.querySelector('.warn-box'),
      hasImg: !!m.querySelector('#gp-img'),
      recap: (m.querySelector('.hint') || {}).textContent || '',
      stateSels: m.querySelectorAll('.st-sel').length,
    };
  })()`);
  const closeModals = async () => {
    await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
    await wait(p, 250);
  };
  const run = async () => {
    await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
    await wait(p, 700);
  };

  // B. 删除状态选择
  await pickGene('male', '卡布奇诺');
  await pickGene('female', '莉莉白');
  const noStateSel = await p.eval(`(() => ({ st: document.querySelectorAll('.st-sel').length, g: document.querySelectorAll('.g-sel').length }))()`);
  ok('预测页删除基因状态选择器（.st-sel 为 0）', noStateSel.st === 0 && noStateSel.g === 2, JSON.stringify(noStateSel));

  // E1. 示例1：莉莉白 × 原色 → 50% 莉莉白 / 50% 原色
  await pickGene('male', '原色');
  await pickGene('female', '莉莉白');
  await run();
  const m1 = await readModal();
  ok('示例1：莉莉白×原色 → 50% 莉莉白 / 50% 原色',
    !!m1 && m1.rows.some((r) => r[0] === '50%' && r[1] === '莉莉白' && r[2] === '莉莉白') && m1.rows.some((r) => r[0] === '50%' && r[1] === '原色'),
    JSON.stringify(m1 && m1.rows));
  await closeModals();

  // E2. 示例2：缺黄 × 莉莉白 → 50% 莉莉白+隐缺黄 / 50% 隐缺黄（v2.4：缺黄仅携带不显现加「隐」）
  await pickGene('male', '缺黄');
  await pickGene('female', '莉莉白');
  await run();
  const m2 = await readModal();
  ok('示例2：缺黄×莉莉白 → 50% 莉莉白+隐缺黄 / 50% 隐缺黄',
    !!m2 && m2.rows.some((r) => r[0] === '50%' && r[1] === '莉莉白+缺黄' && r[2] === '莉莉白+隐缺黄') && m2.rows.some((r) => r[0] === '50%' && r[1] === '缺黄' && r[2] === '隐缺黄'),
    JSON.stringify(m2 && m2.rows));
  await closeModals();

  // D. 超级体命名 + 健康风险：卡布奇诺 × 卡布奇诺
  await pickGene('male', '卡布奇诺');
  await pickGene('female', '卡布奇诺');
  await run();
  const m3 = await readModal();
  ok('卡布奇诺×卡布奇诺 → 50% 卡布奇诺 / 25% 超级卡布奇诺（性状为 卡布奇诺+卡布奇诺 表达式） / 25% 原色',
    !!m3 && m3.rows.some((r) => r[0] === '50%' && r[1] === '卡布奇诺')
      && m3.rows.some((r) => r[0] === '25%' && r[1] === '卡布奇诺+卡布奇诺' && r[2] === '超级卡布奇诺')
      && m3.rows.some((r) => r[0] === '25%' && r[1] === '原色'),
    JSON.stringify(m3 && m3.rows));
  ok('超级体结果附健康风险提示（警告框含「超级卡布奇诺」与健康风险）',
    !!m3 && m3.warn && m3.txt.includes('超级卡布奇诺') && m3.txt.includes('健康风险'),
    JSON.stringify({ warn: m3 && m3.warn, txt: m3 && m3.txt.slice(0, 160) }));
  await closeModals();

  // C. 复合基因拆解：母 缺黄莉莉 × 父 缺黄卡布
  await pickGene('male', '缺黄卡布');
  await pickGene('female', '缺黄莉莉');
  await run();
  const m4 = await readModal();
  ok('复合基因按组分参与计算（缺黄莉莉×缺黄卡布 → 四组 25%）',
    !!m4 && m4.rows.some((r) => r[0] === '25%' && r[1] === '缺黄+卡布奇诺' && r[2].startsWith('缺黄卡布'))
      && m4.rows.some((r) => r[0] === '25%' && r[1] === '缺黄+莉莉白' && r[2].startsWith('缺黄莉莉'))
      && m4.rows.some((r) => r[0] === '25%' && r[1].split('+').length === 3 && r[1].includes('莉莉白') && r[1].includes('卡布奇诺') && r[1].includes('缺黄'))
      && m4.rows.some((r) => r[0] === '25%' && r[1] === '缺黄'),
    JSON.stringify(m4 && m4.rows));
  ok('复合基因弹窗回顾行展示公母复合基因名', !!m4 && m4.recap.includes('缺黄卡布') && m4.recap.includes('缺黄莉莉'), m4 && m4.recap);
  ok('预测弹窗仍支持导出图片', !!m4 && m4.hasImg, String(m4 && m4.hasImg));
  await closeModals();

  /* ===== F. 蛋详情预测：无状态选择 + 复合拆解说明 ===== */
  const eggPair = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const u = await import('./js/util.js');
    const comboM = s.listGenes('sp-crested').find((g) => g.name === '缺黄莉莉');
    const comboF = s.listGenes('sp-crested').find((g) => g.name === '缺黄卡布');
    const mother = await s.createAnimal({ name: 'V23复合母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [comboM.id], geneState: 'v' });
    const father = await s.createAnimal({ name: 'V23复合父${T}', speciesId: 'sp-crested', sex: 'male', geneIds: [comboF.id], geneState: 'v' });
    const egg = await s.createEgg({ motherId: mother.id, fatherId: father.id, speciesId: 'sp-crested', status: 'fertile', layDate: u.todayStr() });
    return egg.id;
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/egg/' + eggPair, 1200);
  await p.eval(`document.getElementById('btn-gpred').click()`, { awaitPromise: false });
  await wait(p, 600);
  const eggModal = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      txt: m.innerText.replace(/\\s+/g, ' '),
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
      stateSels: m.querySelectorAll('.gp-st').length,
      hasImg: !!m.querySelector('#gp-img'),
    };
  })()`);
  ok('蛋详情预测无状态选择器（.gp-st 为 0）', !!eggModal && eggModal.stateSels === 0, JSON.stringify(eggModal && eggModal.stateSels));
  ok('蛋详情预测明示父母本基因（缺黄/莉莉白/卡布奇诺）',
    !!eggModal && eggModal.txt.includes('缺黄') && eggModal.txt.includes('莉莉白') && eggModal.txt.includes('卡布奇诺'),
    eggModal && eggModal.txt.slice(0, 200));
  ok('蛋详情预测复合基因拆解说明（缺黄莉莉 = 缺黄 + 莉莉白）',
    !!eggModal && eggModal.txt.includes('按组分参与计算'),
    eggModal && eggModal.txt.slice(0, 240));
  ok('蛋详情复合父母 → 25% 缺黄卡布 / 25% 缺黄莉莉',
    !!eggModal && eggModal.rows.some((r) => r[0] === '25%' && r[2].startsWith('缺黄卡布')) && eggModal.rows.some((r) => r[0] === '25%' && r[2].startsWith('缺黄莉莉')),
    JSON.stringify(eggModal && eggModal.rows));

  /* ===== 汇总 ===== */
  const pass = R.filter(([, c]) => c).length;
  console.log(`\n===== v2.3 验证结果：${pass}/${R.length} 通过 =====`);
  const fails = R.filter(([, c]) => !c);
  if (fails.length) { console.log('失败项：'); fails.forEach(([n]) => console.log('  ❌ ' + n)); process.exitCode = 1; }
  console.log('CONSOLE-ERRORS:', JSON.stringify(p.consoleErrors));
});
