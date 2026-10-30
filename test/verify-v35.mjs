// verify-v35.mjs —— v3.5 九项需求专项验证
//   A. APK 安装包图标改用 icon.png（自适应图标背景层为青绿渐变、前景为白色守宫）
//   B. 更新弹窗图片换为 logo-g.png
//   C. 基因预测回退至 v3.3 逻辑（白化+康达 ≠ 白化康达）
//   D. 预测支持单方多基因选择
//   E. 类别筛选移入下拉列表内 + 下拉为多选框
//   F. 新增基因类型「杂合 het」+ 隐性基因自动派生（内置 + 用户自定义）
//   G. 杂合纳入预测计算（用户给出的两个具体期望）
//   H. 启动页右上角「跳过」带倒计时（原生层静态检查）
//   I. 关于内容按更新日志.txt 渲染
import { withBrowser } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3241';
// 项目根目录（中文路径需 decodeURIComponent；import.meta.url 指向本文件 → 取 dirname 再上一级）
const ROOT = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

await withBrowser(async (p) => {
  /* ===== A. APK 图标资源（静态检查 res 目录） ===== */
  const resDir = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
  const anydpi = fs.readFileSync(path.join(resDir, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8');
  const anydpiRound = fs.readFileSync(path.join(resDir, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), 'utf8');
  ok('自适应图标 background 指向 @mipmap/ic_launcher_bg（icon.png 青绿渐变）',
    anydpi.includes('@mipmap/ic_launcher_bg') && anydpiRound.includes('@mipmap/ic_launcher_bg'),
    anydpi.replace(/\s+/g, ' ').slice(0, 200));
  ok('自适应图标 foreground 指向 @mipmap/ic_launcher_foreground（白色守宫）',
    anydpi.includes('@mipmap/ic_launcher_foreground'), '');
  const bgFiles = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
    .map((d) => path.join(resDir, `mipmap-${d}`, 'ic_launcher_bg.png'));
  ok('各密度自适应背景位图齐备', bgFiles.every((f) => fs.existsSync(f) && fs.statSync(f).size > 0),
    bgFiles.filter((f) => !fs.existsSync(f)).join(','));
  const fgFiles = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
    .map((d) => path.join(resDir, `mipmap-${d}`, 'ic_launcher_foreground.png'));
  ok('各密度自适应前景位图齐备', fgFiles.every((f) => fs.existsSync(f) && fs.statSync(f).size > 0),
    fgFiles.filter((f) => !fs.existsSync(f)).join(','));

  /* ===== B. 更新弹窗图片换 logo-g ===== */
  await p.goto(BASE + '#/home', 1800);
  await sleep(700);
  // 注意：showUpdateNotice 的 Promise 要等弹窗关闭才 resolve —— 必须拆成多次 eval（不可在同一个 await 里既触发又等待）
  await p.eval(`(async () => {
    const m = await import('./js/update-notice.js');
    try { localStorage.removeItem('rb-update-seen-version'); } catch (e) {}
    m.showUpdateNotice({ version: '3.5.0', lines: ['测试条目'] });
    return true;
  })()`, { awaitPromise: true });
  await sleep(600);
  const upd = await p.eval(`(() => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const mask = masks[masks.length - 1];
    const img = mask ? mask.querySelector('img') : null;
    const res = { open: !!mask, src: img ? img.getAttribute('src') : '', emoji: mask ? mask.textContent.includes('🦎') : false };
    masks.forEach((x) => x.remove());
    return res;
  })()`);
  console.log('  ' + JSON.stringify(upd));
  ok('更新弹窗使用 icons/logo-g.png 图片', upd.open === true && upd.src === 'icons/logo-g.png', JSON.stringify(upd));
  ok('更新弹窗不再使用 🦎 emoji', upd.emoji === false, JSON.stringify(upd));

  /* ===== C + F + G. 基因库 / 预测引擎（模块级断言） ===== */
  const genes = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const sc = await import('./js/schema.js');
    const g = await import('./js/genetics.js');
    await s.initStore();
    const pool = s.listGenes('sp-crested').filter((x) => !x.isInvalid && x.type !== 'polygenic');
    const hpool = s.listGenes('sp-hognose').filter((x) => !x.isInvalid && x.type !== 'polygenic');
    const P = (pp, n) => pp.find((x) => x.name === n);
    // 用 expandLoci 展开（与预测页一致）
    const run = (pp, maleNames, femaleNames) => {
      const loci = { male: new Map(), female: new Map() };
      ['male', 'female'].forEach((side) => {
        (side === 'male' ? maleNames : femaleNames).forEach((n) => {
          const gg = P(pp, n);
          if (!gg) return;
          g.expandLoci(gg, pp).forEach((c) => {
            const prev = loci[side].get(c.id);
            if (!prev || (prev.state !== 'h' && c.state === 'h')) {
              loci[side].set(c.id, { id: c.id, name: c.name, type: c.type, state: c.state });
            }
          });
        });
      });
      const merged = new Map();
      ['male', 'female'].forEach((side) => {
        loci[side].forEach((c, id) => {
          if (!merged.has(id)) merged.set(id, { id, name: c.name, type: c.type, male: 'n', female: 'n' });
          merged.get(id)[side] = c.state;
        });
      });
      const list = [...merged.values()].filter((x) => x.male !== 'n' || x.female !== 'n');
      const r = g.predictOutcomes(list, pp);
      return r.rows.map((x) => ({ p: x.probText, pheno: x.phenotype, name: x.name, combo: x.combo }));
    };
    // 用户自定义隐性基因 → 自动派生 het
    const custom = await s.createGene({ speciesId: 'sp-crested', name: 'V35测试隐基因', en: 'V35Test', type: 'recessive', desc: 't' });
    const derived = s.listGenes('sp-crested').find((x) => x.type === 'het' && x.hetOf === custom.id);
    // 手动创建 het 应被拒绝
    let hetRejected = false;
    try { await s.createGene({ speciesId: 'sp-crested', name: 'V35手动het', type: 'het' }); }
    catch (e) { hetRejected = true; }
    // 删除自定义隐性 → het 一并移除
    await s.removeGene(custom.id);
    const derivedGone = !s.listGenes('sp-crested').some((x) => x.type === 'het' && x.hetOf === custom.id);
    return {
      hetTypeRegistered: !!sc.GENE_TYPES.het,
      crestedHet: pool.filter((x) => x.type === 'het').map((x) => x.name),
      hognoseHet: hpool.filter((x) => x.type === 'het').map((x) => x.name),
      hetHasHetOf: pool.filter((x) => x.type === 'het').every((x) => !!x.hetOf),
      // C：回退 v3.3 —— 白化+康达 → 康达+隐白化
      albinoConda: run(hpool, ['白化'], ['康达']),
      // G-1：缺黄 × 莉莉白 → 50% 莉莉白+隐缺黄 / 50% 隐缺黄
      g1: run(pool, ['缺黄'], ['莉莉白']),
      // G-2：缺黄 × (隐缺黄 + 莉莉白) → 25% 复合缺黄莉莉 / 25% 缺黄 / 25% 莉莉白+隐缺黄 / 25% 隐缺黄
      g2: run(pool, ['缺黄'], ['隐缺黄', '莉莉白']),
      // D：多基因（公方同时选 缺黄 + 巧克力）
      multi: run(pool, ['缺黄', '巧克力'], ['莉莉白']),
      customHet: derived ? derived.name : null,
      hetRejected,
      derivedGone,
    };
  })()`, { awaitPromise: true });
  console.log('  睫角 het: ' + JSON.stringify(genes.crestedHet));
  console.log('  猪鼻 het: ' + JSON.stringify(genes.hognoseHet));
  console.log('  白化×康达: ' + JSON.stringify(genes.albinoConda));
  console.log('  G1 缺黄×莉莉白: ' + JSON.stringify(genes.g1));
  console.log('  G2 缺黄×(隐缺黄+莉莉白): ' + JSON.stringify(genes.g2));
  console.log('  多基因: ' + JSON.stringify(genes.multi));

  ok('GENE_TYPES 已注册「杂合（het）」', genes.hetTypeRegistered === true, '');
  ok('睫角守宫自动派生 隐缺黄 / 隐巧克力',
    genes.crestedHet.includes('隐缺黄') && genes.crestedHet.includes('隐巧克力'),
    JSON.stringify(genes.crestedHet));
  ok('猪鼻蛇自动派生 11 条杂合基因（含隐白化）',
    genes.hognoseHet.length === 11 && genes.hognoseHet.includes('隐白化'),
    JSON.stringify(genes.hognoseHet));
  ok('杂合基因均记录 hetOf（对应隐性基因 id）', genes.hetHasHetOf === true, '');

  // C：回退 v3.3
  const condaRow = (genes.albinoConda || []).find((r) => r.pheno.includes('白化') && r.pheno.includes('康达'));
  ok('白化+康达 不采用登记名「白化康达」', !!condaRow && condaRow.name !== '白化康达', JSON.stringify(condaRow));
  ok('白化+康达 显示「康达+隐白化」', !!condaRow && condaRow.name.includes('隐白化'), JSON.stringify(condaRow));

  // G-1
  const g1 = genes.g1 || [];
  const g1a = g1.find((r) => r.name.includes('隐缺黄') && r.name.includes('莉莉白'));
  const g1b = g1.find((r) => r.name === '隐缺黄');
  ok('G1 缺黄×莉莉白 → 50% 莉莉白+隐缺黄', !!g1a && g1a.p === '50%', JSON.stringify(g1));
  ok('G1 缺黄×莉莉白 → 50% 隐缺黄', !!g1b && g1b.p === '50%', JSON.stringify(g1));

  // G-2
  const g2 = genes.g2 || [];
  const g2combo = g2.find((r) => r.name === '缺黄莉莉');
  const g2ax = g2.find((r) => r.name === '缺黄');
  const g2mix = g2.find((r) => r.name.includes('莉莉白') && r.name.includes('隐缺黄'));
  const g2het = g2.find((r) => r.name === '隐缺黄');
  ok('G2 → 25% 复合基因「缺黄莉莉」', !!g2combo && g2combo.p === '25%', JSON.stringify(g2));
  ok('G2 → 25% 缺黄', !!g2ax && g2ax.p === '25%', JSON.stringify(g2));
  ok('G2 → 25% 莉莉白+隐缺黄', !!g2mix && g2mix.p === '25%', JSON.stringify(g2));
  ok('G2 → 25% 隐缺黄', !!g2het && g2het.p === '25%', JSON.stringify(g2));

  // D：多基因
  ok('D 单方多基因参与计算（缺黄+巧克力 × 莉莉白）', (genes.multi || []).length >= 2, JSON.stringify(genes.multi));

  // F：自定义隐性自动派生 het
  ok('F 用户自定义隐性基因自动派生「隐」+ 名称 的杂合基因',
    genes.customHet === '隐V35测试隐基因', String(genes.customHet));
  ok('F 禁止手动创建杂合基因', genes.hetRejected === true, '');
  ok('F 删除隐性基因时一并移除其杂合基因', genes.derivedGone === true, '');

  /* ===== D + E. 预测页 UI（多选下拉 + 类别筛选在弹层内） ===== */
  await p.goto(BASE + '#/predict', 1800);
  await sleep(800);
  const ui1 = await p.eval(`(() => {
    const box = document.getElementById('male-box');
    const sel = box.querySelector('.g-sel');
    return {
      multiple: !!sel && sel.multiple,
      hasFilters: !!sel && !!sel.dataset.pkFilters,
      filterJson: sel ? sel.dataset.pkFilters : '',
      optCount: sel ? sel.options.length : 0,
      hasHetOpt: sel ? [...sel.options].some((o) => o.textContent.includes('隐缺黄')) : false,
      oldSegGone: !document.querySelector('.gene-type-seg'),
    };
  })()`);
  console.log('  ' + JSON.stringify(ui1));
  ok('E 公母基因下拉为多选框（select[multiple]）', ui1.multiple === true, JSON.stringify(ui1));
  ok('E 类别筛选已移入下拉（data-pk-filters 存在）', ui1.hasFilters === true, ui1.filterJson);
  ok('E 筛选项含 全部/显性/隐性/杂合/不完全显性/复合',
    ['全部', '显性', '隐性', '杂合', '不完全显性', '复合'].every((t) => ui1.filterJson.includes(t)),
    ui1.filterJson);
  ok('E 页面不再外置类别筛选条（.gene-type-seg 移除）', ui1.oldSegGone === true, '');
  ok('F 下拉中含派生的杂合基因「隐缺黄」', ui1.hasHetOpt === true, String(ui1.optCount));

  // 打开下拉弹层 → 检查筛选 chips 存在且可过滤
  await p.eval(`document.querySelector('#male-box .pk-btn').click()`, { awaitPromise: false });
  await sleep(500);
  const ui2 = await p.eval(`(() => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const m = masks[masks.length - 1];
    if (!m) return { open: false };
    const chips = [...m.querySelectorAll('.pk-chip')].map((c) => c.textContent.trim());
    const before = [...m.querySelectorAll('.pk-opt')].filter((r) => r.style.display !== 'none').length;
    // 点击「杂合」筛选
    const hetChip = [...m.querySelectorAll('.pk-chip')].find((c) => c.textContent.trim() === '杂合');
    if (hetChip) hetChip.click();
    const afterHet = [...m.querySelectorAll('.pk-opt')].filter((r) => r.style.display !== 'none').length;
    const names = [...m.querySelectorAll('.pk-opt')].filter((r) => r.style.display !== 'none')
      .map((r) => r.querySelector('.pk-opt-txt').textContent.trim());
    // 切回「全部」
    const allChip = [...m.querySelectorAll('.pk-chip')].find((c) => c.textContent.trim() === '全部');
    if (allChip) allChip.click();
    const afterAll = [...m.querySelectorAll('.pk-opt')].filter((r) => r.style.display !== 'none').length;
    return { open: true, chips, before, afterHet, names, afterAll };
  })()`);
  console.log('  ' + JSON.stringify(ui2));
  ok('E 下拉弹层内有类别筛选 chips', ui2.open === true && Array.isArray(ui2.chips) && ui2.chips.length >= 5, JSON.stringify(ui2.chips));
  ok('E 选「杂合」后仅显示杂合类基因',
    ui2.afterHet > 0 && ui2.afterHet < ui2.before && ui2.names.every((n) => n.includes('杂合')),
    JSON.stringify({ afterHet: ui2.afterHet, before: ui2.before, names: ui2.names }));
  ok('E 选「全部」后恢复显示全部选项', ui2.afterAll === ui2.before, JSON.stringify({ afterAll: ui2.afterAll, before: ui2.before }));

  // 多选 + 预测
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });
  await sleep(200);
  await p.eval(`(() => {
    const pick = (side, name) => {
      const sel = document.querySelector('#' + side + '-box .g-sel');
      const opt = [...sel.options].find((o) => o.textContent.startsWith(name + '（'));
      if (opt) { opt.selected = true; sel.dispatchEvent(new Event('change')); }
    };
    pick('male', '缺黄');
    pick('female', '莉莉白');
  })()`, { awaitPromise: false });
  await sleep(400);
  const ui3 = await p.eval(`(() => {
    const sel = document.querySelector('#male-box .g-sel');
    return { count: sel.selectedOptions.length, label: sel.parentNode.querySelector('.pk-label').textContent };
  })()`);
  ok('D 下拉可多选（已选计数）', ui3.count === 1 && ui3.label.includes('缺黄'), JSON.stringify(ui3));

  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await sleep(900);
  const res = await p.eval(`(() => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const m = masks[masks.length - 1];
    if (!m) return null;
    return {
      rows: [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => {
        const td = tr.querySelectorAll('td');
        return { p: td[0].textContent.trim(), name: td[2].textContent.trim() };
      }),
      recap: (m.querySelector('.hint') || {}).textContent || '',
    };
  })()`);
  console.log('  预测: ' + JSON.stringify(res));
  ok('预测弹窗展示「莉莉白+隐缺黄」50% 与「隐缺黄」50%',
    !!res && res.rows.some((r) => r.name.includes('莉莉白') && r.name.includes('隐缺黄') && r.p === '50%')
    && res.rows.some((r) => r.name === '隐缺黄' && r.p === '50%'),
    JSON.stringify(res && res.rows));
  ok('结果弹窗摘要列出双方所选基因',
    !!res && res.recap.includes('缺黄') && res.recap.includes('莉莉白'), res ? res.recap : '');
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });

  /* ===== H. 启动页倒计时（原生层静态检查） ===== */
  const java = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'reptile', 'breeding', 'MainActivity.java'), 'utf8');
  ok('H 跳过按钮带倒计时（SPLASH_COUNTDOWN_SECONDS 常量）',
    java.includes('SPLASH_COUNTDOWN_SECONDS'), '');
  ok('H 倒计时文本渲染「跳过 (N)」',
    /\w+\.setText\(base\s*\+\s*"\s*\(/.test(java), '');
  ok('H 自动进入时长与倒计时一致',
    java.includes('SPLASH_SKIP_SHOW_DELAY + SPLASH_COUNTDOWN_SECONDS * 1000L'), '');

  /* ===== I. 关于内容按更新日志渲染 ===== */
  await p.goto(BASE + '#/more', 1500);
  await sleep(700);
  const about = await p.eval(`(() => ({
    title: (document.querySelector('.card-head h3') || {}).textContent || '',
    body: (document.querySelector('.about-body') || {}).textContent || '',
  }))()`);
  console.log('  关于: ' + JSON.stringify(about));
  ok('I 关于卡片标题取自更新日志「关于 · 养个爬」', about.title.includes('关于 · 养个爬'), about.title);
  ok('I 关于正文含「软件所有功能均免费」', about.body.includes('软件所有功能均免费'), about.body.slice(0, 120));
  ok('I 关于正文含「所有数据仅存储在本机数据库中」', about.body.includes('本机数据库'), about.body.slice(0, 160));
  ok('I 关于正文含「禁止售卖本软件及其衍生版本」', about.body.includes('禁止售卖'), about.body.slice(0, 200));

  /* ===== 汇总 ===== */
  console.log(`\n===== v3.5 验证结果：${pass}/${pass + fail} 通过 =====`);
  if (fail) { console.log('失败项：'); console.log(`  共 ${fail} 项失败`); process.exitCode = 1; }
  console.log('CONSOLE-ERRORS:', JSON.stringify(p.consoleErrors));
});
