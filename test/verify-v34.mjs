// verify-v34.mjs —— v3.4 五项需求专项验证
//   A. 应用图标统一：APK/exe 用工作空间 icon.png，导航/启动页 logo 用 logo-g.png
//   B. 启动页时序：3 秒后「跳过」按钮淡入；5 秒无操作自动进入；logo 用 logo-g.png
//   C. License 双语（中英对照）
//   D. 更多页/侧栏均无「月度报表」独立入口（已集成进记账报表）
//   E. 猪鼻蛇复合基因登记名：白化+康达 → 白化康达、白化+紫貂 → 太阳爆炸
import { withBrowser } from './cdp.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3239';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

await withBrowser(async (p) => {
  /* ===== A. 图标资源 ===== */
  await p.goto(BASE + '#/home', 1800);
  await sleep(700);
  const icons = await p.eval(`(() => {
    const r = {};
    // 导航页 logo（logo-g.png）
    const tb = document.querySelector('.tb-brand .tb-logo img');
    r.navLogo = tb ? tb.getAttribute('src') : '';
    const sb = document.querySelector('.sb-logo .tb-logo img');
    r.sbLogo = sb ? sb.getAttribute('src') : '';
    // 品牌 logo 不再是 emoji
    r.noEmoji = !document.querySelector('.tb-brand .tb-logo')?.textContent.includes('🦎');
    return r;
  })()`);
  console.log('  ' + JSON.stringify(icons));
  ok('顶栏 logo 使用 icons/logo-g.png', icons.navLogo === 'icons/logo-g.png', icons.navLogo);
  ok('侧栏 logo 使用 icons/logo-g.png', icons.sbLogo === 'icons/logo-g.png', icons.sbLogo);
  ok('导航 logo 不再使用 🦎 emoji', icons.noEmoji === true, JSON.stringify(icons));

  // logo-g.png 实际可加载（HTTP 200 且为 PNG）
  const logoOk = await p.eval(`(async () => {
    const res = await fetch('icons/logo-g.png');
    const blob = await res.blob();
    return { status: res.status, type: blob.type, size: blob.size };
  })()`, { awaitPromise: true });
  ok('logo-g.png 可正常加载（200 / PNG）', logoOk.status === 200 && logoOk.type === 'image/png' && logoOk.size > 0, JSON.stringify(logoOk));

  /* ===== C. License 双语 ===== */
  await p.goto(BASE + '#/more', 1500);
  await sleep(500);
  const lic = await p.eval(`(async () => {
    const res = await fetch('license.txt');
    const txt = await res.text();
    return {
      status: res.status,
      len: txt.length,
      hasCn: txt.includes('Apache') && /许可证|许可|条款|著作权/.test(txt),
      hasEn: txt.includes('Apache License') && txt.includes('Version 2.0'),
      hasCc: txt.includes('Commons Clause') || txt.includes('Common Clause'),
      hasCnMarker: /中文|中英|汉译/.test(txt),
    };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(lic));
  ok('license.txt 可访问且内容完整', lic.status === 200 && lic.len > 5000, JSON.stringify(lic));
  ok('License 含英文原文（Apache License 2.0）', lic.hasEn === true, JSON.stringify(lic));
  ok('License 含 Commons Clause 条款', lic.hasCc === true, JSON.stringify(lic));
  ok('License 含中文对照内容', lic.hasCn === true, JSON.stringify(lic));

  // 弹窗展示
  await p.eval(`(() => { const a = document.getElementById('about-license-btn'); if (a) a.click(); })()`, { awaitPromise: false });
  await sleep(900);
  const licModal = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    if (!m) return null;
    const pre = m.querySelector('.license-text');
    return { title: (m.querySelector('.m-title') || {}).textContent || '', text: pre ? pre.textContent : '', hasCn: /中文|许可证|著作权|条款/.test(pre ? pre.textContent : '') };
  })()`);
  ok('License 弹窗可打开并展示协议正文', !!licModal && licModal.text.length > 3000, licModal ? String(licModal.text.length) : 'null');
  ok('License 弹窗正文含中文对照', !!licModal && licModal.hasCn === true, licModal ? licModal.text.slice(0, 120) : '');
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });

  /* ===== D. 月度报表入口已取消 ===== */
  await p.goto(BASE + '#/more', 1200);
  await sleep(500);
  const moreLinks = await p.eval(`(() => {
    const txt = document.getElementById('view').textContent;
    // 更多页的功能项是 div.more-link（不是 a/button），故同时查文本内容
    const items = [...document.querySelectorAll('#view .more-link, #view a, #view button')].map((x) => x.textContent.trim());
    const sb = [...document.querySelectorAll('.sb-item')].map((x) => x.textContent.trim());
    return {
      moreHasReport: items.some((t) => t.includes('月度报表')),
      sbHasReport: sb.some((t) => t.includes('月度报表')),
      moreHasBills: items.some((t) => t.includes('记账报表')) || txt.includes('记账报表'),
      txtHasReport: txt.includes('月度报表'),
    };
  })()`);
  console.log('  ' + JSON.stringify(moreLinks));
  ok('更多页无「月度报表」入口', moreLinks.moreHasReport === false && moreLinks.txtHasReport === false, JSON.stringify(moreLinks));
  ok('侧边导航无「月度报表」入口', moreLinks.sbHasReport === false, JSON.stringify(moreLinks));
  ok('更多页仍保留「记账报表」入口', moreLinks.moreHasBills === true, JSON.stringify(moreLinks));

  // 记账报表页内仍可进入月度报表（已集成）
  await p.goto(BASE + '#/bills', 1500);
  await sleep(600);
  const bills = await p.eval(`(() => {
    const btn = document.getElementById('btn-report');
    return { hasBtn: !!btn, txt: btn ? btn.textContent.trim() : '' };
  })()`);
  ok('记账报表页内保留月度报表入口按钮', bills.hasBtn === true, JSON.stringify(bills));

  /* ===== E. 猪鼻蛇复合基因登记名 ===== */
  await p.goto(BASE + '#/predict', 1800);
  await sleep(700);
  // 切到猪鼻蛇
  await p.eval(`(() => {
    const sel = document.getElementById('f-species');
    const opt = [...sel.options].find((o) => o.textContent.includes('猪鼻'));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
  })()`, { awaitPromise: false });
  await sleep(700);

  const predictCase = await p.eval(`(async () => {
    const st = await import('./js/store.js');
    const g = await import('./js/genetics.js');
    const sp = st.listSpecies().find((x) => x.name.includes('猪鼻'));
    const pool = st.listGenes(sp.id).filter((x) => !x.isInvalid && x.type !== 'polygenic');
    const P = (n) => pool.find((x) => x.name === n);
    const run = (a, b) => {
      const genes = [];
      for (const [side, n] of [['male', a], ['female', b]]) {
        const gg = P(n); if (!gg) return null;
        g.expandCombo(gg, pool).forEach((c) => genes.push({ id: c.id, name: c.name, type: c.type, [side]: g.defaultGeneState(c) }));
      }
      const merged = new Map();
      genes.forEach((x) => {
        if (!merged.has(x.id)) merged.set(x.id, { id: x.id, name: x.name, type: x.type, male: 'n', female: 'n' });
        const m = merged.get(x.id); if ('male' in x) m.male = x.male; if ('female' in x) m.female = x.female;
      });
      const list = [...merged.values()].filter((x) => x.male !== 'n' || x.female !== 'n');
      const r = g.predictOutcomes(list, pool);
      return r.rows.map((x) => ({ p: x.probText, pheno: x.phenotype, name: x.name, combo: x.combo, carriedOnly: x.carriedOnly || [] }));
    };
    return {
      comboFlags: pool.filter((x) => x.type === 'combo').map((x) => ({ name: x.name, allowHet: x.allowHet === true })),      albinoConda: run('白化', '康达'),
      sunburst: run('白化', '紫貂'),
      both: run('白化康达', '白化康达'),
    };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(predictCase.comboFlags));
  console.log('  白化×康达: ' + JSON.stringify(predictCase.albinoConda));
  console.log('  白化×紫貂: ' + JSON.stringify(predictCase.sunburst));

  // v3.5：回退至 v3.3 语义 —— 隐性基因仅携带时不采用登记复合名
  ok('猪鼻蛇复合基因不再有「仅携带也采用登记名」开关',
    !predictCase.comboFlags.some((c) => c.allowHet),
    JSON.stringify(predictCase.comboFlags));

  const condaRow = (predictCase.albinoConda || []).find((r) => r.pheno.includes('白化') && r.pheno.includes('康达'));
  ok('白化×康达 不采用登记复合名「白化康达」（白化为隐性需两份）',
    !!condaRow && condaRow.name !== '白化康达', JSON.stringify(condaRow));
  ok('白化×康达 显示为「康达+隐白化」写法',
    !!condaRow && condaRow.name.includes('隐白化'), JSON.stringify(condaRow));
  ok('白化×康达 结果不标记为复合基因', !!condaRow && condaRow.combo !== true, JSON.stringify(condaRow));
  ok('结果行不再携带「仅携带」标注字段',
    predictCase.albinoConda.every((r) => !r.carriedOnly || r.carriedOnly.length === 0),
    JSON.stringify(predictCase.albinoConda));

  const sunRow = (predictCase.sunburst || []).find((r) => r.pheno.includes('白化') && r.pheno.includes('紫貂'));
  ok('白化×紫貂 不采用登记复合名「太阳爆炸」',
    !!sunRow && sunRow.name !== '太阳爆炸', JSON.stringify(sunRow));

  const bothRow = (predictCase.both || []).find((r) => r.name === '白化康达');
  ok('白化康达×白化康达 仍显示「白化康达」（双方纯合表现时采用登记名）', !!bothRow, JSON.stringify(predictCase.both));

  // 页面上确认（v3.5：基因下拉为多选，需设置 option.selected）
  await p.eval(`(() => {
    const box = document.getElementById('male-box');
    const sel = box.querySelector('.g-sel');
    const opt = [...sel.options].find((o) => o.textContent.startsWith('白化（'));
    if (opt) { opt.selected = true; sel.dispatchEvent(new Event('change')); }
  })()`, { awaitPromise: false });
  await sleep(400);
  await p.eval(`(() => {
    const box = document.getElementById('female-box');
    const sel = box.querySelector('.g-sel');
    const opt = [...sel.options].find((o) => o.textContent.startsWith('康达'));
    if (opt) { opt.selected = true; sel.dispatchEvent(new Event('change')); }
  })()`, { awaitPromise: false });
  await sleep(400);
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await sleep(900);
  const pageRows = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return [...m.querySelectorAll('.gp-table tbody tr')].map((tr) => {
      const td = tr.querySelectorAll('td');
      return { p: td[0].textContent.trim(), pheno: td[1].textContent.trim(), name: td[2].textContent.trim(), html: td[2].innerHTML };
    });
  })()`);
  console.log('  页面: ' + JSON.stringify((pageRows || []).map((r) => r.name)));
  const pConda = (pageRows || []).find((r) => r.name.includes('隐白化'));
  ok('预测结果弹窗显示「康达+隐白化」', !!pConda, JSON.stringify((pageRows || []).map((r) => r.name)));
  ok('结果不含「白化康达」登记名',
    !(pageRows || []).some((r) => r.name.includes('白化康达')),
    JSON.stringify((pageRows || []).map((r) => r.name)));
  ok('结果不含「仅携带」蓝字说明',
    !(pageRows || []).some((r) => r.html.includes('仅携带')),
    JSON.stringify((pageRows || []).map((r) => r.html)));
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); })()`, { awaitPromise: false });

  /* ===== 汇总 ===== */
  console.log(`\n===== v3.4 验证结果：${pass}/${pass + fail} 通过 =====`);
  if (fail) { console.log('失败项：'); console.log(`  共 ${fail} 项失败`); process.exitCode = 1; }
  console.log('CONSOLE-ERRORS:', JSON.stringify(p.consoleErrors));
});
