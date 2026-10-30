// verify-v31.mjs —— v3.1：食物库 / 日志增删改 / 物种库改删 / 成长记录分页滑动
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3236';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};
const T = Date.now().toString(36).slice(-5);

await withBrowser(async (p) => {
  /* ===== A. 数据层：食物库 ===== */
  await p.goto(BASE + '#/home', 1500);
  await seedFixture(p);

  const A = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const foods = s.listFoods();
    const names = foods.map(f => f.name);
    const cricket = foods.find(f => f.name === '白蟋蟀');
    const mouse = foods.find(f => f.name === '冻鼠');
    const fruit = foods.find(f => f.name === '果泥');
    // 新建自定义食物（通用）
    const gen = await s.createFood({ name: '通用测试虫', speciesId: [] });
    // 新建专属食物
    const own = await s.createFood({ name: '专属测试粮', speciesId: ['sp-hognose'] });
    const after = s.listFoods();
    return {
      n: foods.length,
      names,
      hasCricket: !!cricket, hasMouse: !!mouse, hasFruit: !!fruit,
      cricketSp: cricket ? cricket.speciesId : null,
      mouseSp: mouse ? mouse.speciesId : null,
      genSp: gen.speciesId,
      ownSp: own.speciesId,
      customFlag: gen.isCustom === true,
      // 物种可见性：通用食物对所有物种可见
      visGenericCrested: s.foodsForSpecies('sp-crested').some(f => f.name === '通用测试虫'),
      visGenericHognose: s.foodsForSpecies('sp-hognose').some(f => f.name === '通用测试虫'),
      visOwnHognose: s.foodsForSpecies('sp-hognose').some(f => f.name === '专属测试粮'),
      visOwnCrested: s.foodsForSpecies('sp-crested').some(f => f.name === '专属测试粮'),
      afterNames: after.map(f => f.name),
    };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(A));
  ok('内置食物三条齐备（白蟋蟀/果泥/冻鼠）', A.hasCricket && A.hasMouse && A.hasFruit, JSON.stringify(A.names));
  ok('白蟋蟀归属睫角守宫', Array.isArray(A.cricketSp) && A.cricketSp.includes('sp-crested'), JSON.stringify(A.cricketSp));
  ok('冻鼠归属猪鼻蛇', Array.isArray(A.mouseSp) && A.mouseSp.includes('sp-hognose'), JSON.stringify(A.mouseSp));
  ok('可创建通用食物（物种为空）', Array.isArray(A.genSp) && A.genSp.length === 0, JSON.stringify(A.genSp));
  ok('可创建多物种归属食物', Array.isArray(A.ownSp) && A.ownSp.length === 1 && A.ownSp[0] === 'sp-hognose', JSON.stringify(A.ownSp));
  ok('通用食物对所有物种可见', A.visGenericCrested === true && A.visGenericHognose === true, '');
  ok('专属食物仅对所属物种可见', A.visOwnHognose === true && A.visOwnCrested === false, '');

  /* ===== B. 食物库增删改查 ===== */
  const B = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const f = (await s.createFood({ name: '可改测试食物', speciesId: ['sp-crested'] }));
    await s.updateFood(f.id, { name: '已改名测试食物', speciesId: ['sp-hognose', 'sp-crested'] });
    const after = s.listFoods().find(x => x.id === f.id);
    let dup = false;
    try { await s.createFood({ name: '已改名测试食物' }); } catch (e) { dup = true; }
    let empty = false;
    try { await s.createFood({ name: '  ' }); } catch (e) { empty = true; }
    await s.removeFood(f.id);
    const gone = !s.listFoods().some(x => x.id === f.id);
    return { name: after.name, sp: after.speciesId, dup, empty, gone };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(B));
  ok('食物可修改（名称 + 多物种类型）', B.name === '已改名测试食物' && B.sp.length === 2, JSON.stringify(B));
  ok('同名食物被拒绝', B.dup === true, '');
  ok('空名称被拒绝', B.empty === true, '');
  ok('食物可删除', B.gone === true, '');

  /* ===== C. 物种库：修改 + 删除（内置受保护） ===== */
  const C = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const sp = await s.createSpecies('可改物种${Date.now()}');
    await s.updateSpecies(sp.id, { name: '改名物种' });
    const renamed = s.listSpecies().find(x => x.id === sp.id).name;
    let builtinUpdate = false, builtinDelete = false;
    try { await s.updateSpecies('sp-crested', { name: 'X' }); } catch (e) { builtinUpdate = true; }
    try { await s.removeSpecies('sp-crested'); } catch (e) { builtinDelete = true; }
    let usedDelete = false;
    const used = s.S.animal.find(a => a.speciesId === sp.id);
    if (used) { try { await s.removeSpecies(sp.id); } catch (e) { usedDelete = true; } }
    else { await s.removeSpecies(sp.id); }
    return { renamed, builtinUpdate, builtinDelete, usedDelete };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(C));
  ok('自定义物种可修改名称', C.renamed === '改名物种', C.renamed);
  ok('内置物种不可修改', C.builtinUpdate === true, '');
  ok('内置物种不可删除', C.builtinDelete === true, '');

  /* ===== D. 饲养日志页：食物库按钮 + 每条记录改删 ===== */
  await p.goto(BASE + '#/logs', 2000);
  await sleep(800);
  const D = await p.eval(`(() => {
    const v = document.getElementById('view');
    const head = v.querySelector('.page-head');
    const acts = head ? [...head.querySelectorAll('.btn-row .btn')] : [];
    const rows = [...v.querySelectorAll('.list .row')];
    return {
      foodBtn: !!v.querySelector('#lg-foodlib'),
      foodBtnText: (v.querySelector('#lg-foodlib') || {}).textContent || '',
      sameRow: acts.length > 0 ? Math.abs(acts[0].getBoundingClientRect().top - (v.querySelector('.page-title') || {}).getBoundingClientRect?.().top || 0) < 60 : false,
      rowCount: rows.length,
      editBtns: rows.filter(r => r.querySelector('[data-edit]')).length,
      delBtns: rows.filter(r => r.querySelector('[data-del]')).length,
      title: (v.querySelector('.page-title') || {}).textContent || '',
    };
  })()`);
  console.log('  ' + JSON.stringify(D));
  ok('饲养日志页右上角有「食物库」按钮', D.foodBtn === true, '');
  ok('按钮文字含「食物库」', D.foodBtnText.includes('食物库'), D.foodBtnText);
  ok('按钮与标题同行（页面头部）', D.sameRow === true, '');
  ok('每条记录都有修改按钮', D.editBtns === D.rowCount && D.rowCount > 0, `${D.editBtns}/${D.rowCount}`);
  ok('每条记录都有删除按钮', D.delBtns === D.rowCount && D.rowCount > 0, `${D.delBtns}/${D.rowCount}`);

  /* ===== E. 食物库弹层：增删查改 ===== */
  await p.eval(`document.getElementById('lg-foodlib').click()`, { awaitPromise: false });
  await sleep(600);
  const E1 = await p.eval(`(() => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const m = masks[masks.length - 1];
    return {
      n: masks.length,
      title: m.querySelector('.m-title') ? m.querySelector('.m-title').textContent : '',
      hasSearch: !!m.querySelector('#fl-q'),
      rows: m.querySelectorAll('#fl-list .row').length,
      hasAdd: [...m.querySelectorAll('.m-foot .btn')].some(b => b.textContent.includes('新增食物')),
      editBtns: m.querySelectorAll('#fl-list [data-edit]').length,
      delBtns: m.querySelectorAll('#fl-list [data-del]').length,
      hasBuiltinTag: m.querySelector('#fl-list').textContent.includes('内置'),
    };
  })()`);
  console.log('  ' + JSON.stringify(E1));
  ok('点击弹出食物库弹层', E1.n >= 1 && E1.title.includes('食物库'), JSON.stringify(E1));
  ok('食物库有搜索框', E1.hasSearch === true, '');
  ok('食物库有「新增食物」按钮', E1.hasAdd === true, '');
  ok('食物库列表有内置标记', E1.hasBuiltinTag === true, '');
  ok('食物库每条有修改/删除按钮', E1.editBtns === E1.rows && E1.rows > 0 && E1.delBtns === E1.rows, `${E1.editBtns}/${E1.delBtns}/${E1.rows}`);

  // 搜索过滤
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const q = m.querySelector('#fl-q');
    q.value = '白蟋蟀';
    q.dispatchEvent(new Event('input'));
  })()`, { awaitPromise: false });
  await sleep(400);
  const E2 = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const rows = [...m.querySelectorAll('#fl-list .row')];
    return { n: rows.length, texts: rows.map(r => r.textContent) };
  })()`);
  ok('食物库搜索过滤生效', E2.n === 1 && E2.texts[0].includes('白蟋蟀'), JSON.stringify(E2));

  // 新增食物（类型多选 + 名称）
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const q = m.querySelector('#fl-q');
    q.value = '';
    q.dispatchEvent(new Event('input'));
    [...m.querySelectorAll('.m-foot .btn')].find(b => b.textContent.includes('新增食物')).click();
  })()`, { awaitPromise: false });
  await sleep(700);
  const E3 = await p.eval(`(() => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const m = masks[masks.length - 1];
    const spSel = m.querySelector('#fd-species');
    return {
      n: masks.length,
      title: m.querySelector('.m-title') ? m.querySelector('.m-title').textContent : '',
      hasSpecies: !!spSel,
      multiple: spSel ? !!spSel.multiple : false,
      spOptions: spSel ? [...spSel.options].map(o => o.textContent) : [],
      hasName: !!m.querySelector('#fd-name'),
      firstFieldLabel: m.querySelector('.m-body .field label') ? m.querySelector('.m-body .field label').textContent : '',
      order: [...m.querySelectorAll('.m-body .field label')].map(l => l.textContent),
    };
  })()`);
  console.log('  ' + JSON.stringify(E3));
  ok('新增食物弹窗打开', E3.n >= 2 && E3.title.includes('新增食物'), JSON.stringify(E3));
  ok('第一行是「类型」，第二行是「食物」', E3.order[0].includes('类型') && E3.order[1] && E3.order[1].includes('食物'), JSON.stringify(E3.order));
  ok('类型下拉可多选', E3.multiple === true, '');
  ok('类型下拉列出全部物种', E3.spOptions.length >= 2, JSON.stringify(E3.spOptions));
  ok('食物名称输入框存在', E3.hasName === true, '');

  // 类型弹层：多选行为
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    m.querySelector('.pk-btn').click();
  })()`, { awaitPromise: false });
  await sleep(600);
  const E4 = await p.eval(`(() => {
    const masks = [...document.querySelectorAll('.modal-mask')];
    const m = masks[masks.length - 1];
    const opts = [...m.querySelectorAll('#pk-list .pk-opt')];
    return {
      n: masks.length,
      opts: opts.length,
      hasBox: opts.every(o => !!o.querySelector('.pk-box')),
      hasOk: !!m.querySelector('#pk-ok'),
      hasClear: !!m.querySelector('#pk-clear'),
    };
  })()`);
  console.log('  ' + JSON.stringify(E4));
  ok('多选弹层打开且列出全部物种', E4.opts >= 2, JSON.stringify(E4));
  ok('多选弹层每项带复选框', E4.hasBox === true, '');
  ok('多选弹层有确定/清空', E4.hasOk === true && E4.hasClear === true, '');

  // 勾选两个物种 → 确定
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const opts = [...m.querySelectorAll('#pk-list .pk-opt')];
    opts[0].click(); opts[1].click();
    m.querySelector('#pk-ok').click();
  })()`, { awaitPromise: false });
  await sleep(600);
  const E5 = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const spSel = m.querySelector('#fd-species');
    const pick = m.querySelector('.pk-btn .pk-label');
    return {
      selected: spSel ? [...spSel.selectedOptions].map(o => o.value) : [],
      label: pick ? pick.textContent : '',
    };
  })()`);
  console.log('  ' + JSON.stringify(E5));
  ok('多选确定后写回原生 select', E5.selected.length === 2, JSON.stringify(E5.selected));
  ok('触发器显示已选数量', E5.label.includes('已选 2'), E5.label);

  // 名称留空 → 保存被拒
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    m.querySelector('#fd-name').value = '';
    [...m.querySelectorAll('.m-foot .btn')].find(b => b.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await sleep(500);
  const E6 = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const masks = [...document.querySelectorAll('.modal-mask')];
    return {
      stillOpen: masks.length >= 2,
      toastTxt: (document.querySelector('#toast-root') || {}).textContent || '',
      count: s.listFoods().filter(f => f.name === '').length,
    };
  })()`, { awaitPromise: true });
  ok('空名称保存被拒绝（弹窗不关闭）', E6.stillOpen === true && E6.count === 0, JSON.stringify(E6));

  // 填名称 → 保存
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    m.querySelector('#fd-name').value = '弹窗新建食物';
    [...m.querySelectorAll('.m-foot .btn')].find(b => b.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await sleep(800);
  const E7 = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const f = s.listFoods().find(x => x.name === '弹窗新建食物');
    return { exists: !!f, sp: f ? f.speciesId : null };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(E7));
  ok('弹窗新建食物成功入库', E7.exists === true, JSON.stringify(E7));
  ok('新建食物带上了所选类型', Array.isArray(E7.sp) && E7.sp.length === 2, JSON.stringify(E7.sp));

  // 关闭所有弹窗
  await p.eval(`document.querySelectorAll('.modal-mask').forEach(m => m.remove())`, { awaitPromise: false });
  await sleep(300);

  /* ===== F. 饲养日志记录修改 / 删除 ===== */
  // 造一条日志
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = await s.createAnimal({ name: 'V31日志甲', speciesId: 'sp-crested', sex: 'male' });
    await s.addLog(a.id, 'feed', { food: '旧食物', qty: '1', ate: '吃完', note: '' });
  })()`, { awaitPromise: true });
  // goto 同 hash 不触发重渲染 → 先跳离再跳回
  await p.goto(BASE + '#/home', 1200);
  await p.goto(BASE + '#/logs', 2000);
  await sleep(900);
  const F2 = await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#view .list .row')];
    const r = rows.find(x => x.textContent.includes('V31日志甲'));
    return { found: !!r, hasEdit: r ? !!r.querySelector('[data-edit]') : false, total: rows.length };
  })()`);
  ok('新写入的日志出现在列表中', F2.found === true, JSON.stringify(F2));

  // 点修改 → 改食物 → 保存
  await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#view .list .row')];
    const r = rows.find(x => x.textContent.includes('V31日志甲'));
    r.querySelector('[data-edit]').click();
  })()`, { awaitPromise: false });
  await sleep(700);
  const F3 = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const pick = m.querySelector('#lg-food-pick');
    return {
      title: m.querySelector('.m-title') ? m.querySelector('.m-title').textContent : '',
      foodVal: pick ? pick.value : '',
      hasFoodInput: !!m.querySelector('#lg-food'),
      hasQty: !!m.querySelector('#lg-qty'),
      hasPick: !!pick,
      pickOpts: pick ? [...pick.options].map(o => o.textContent) : [],
    };
  })()`);
  console.log('  ' + JSON.stringify(F3));
  ok('修改弹窗标题为「修改喂食记录」', F3.title.includes('修改'), F3.title);
  ok('修改弹窗回填原食物', F3.foodVal === '旧食物', F3.foodVal);
  ok('修改弹窗含食物库快捷选择', F3.hasPick === true && F3.pickOpts.some(t => t.includes('白蟋蟀')), JSON.stringify(F3.pickOpts));
  ok('喂食表单不再有食物文本输入框', F3.hasFoodInput === false, String(F3.hasFoodInput));

  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const pick = m.querySelector('#lg-food-pick');
    pick.value = '白蟋蟀';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    [...m.querySelectorAll('.m-foot .btn')].find(b => b.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await sleep(800);
  const F4 = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.S.animal.find(x => x.name === 'V31日志甲');
    const logs = s.listLogs(a.id, 'feed');
    return { food: logs.length ? logs[0].data.food : '' };
  })()`, { awaitPromise: true });
  ok('日志修改已保存', F4.food === '白蟋蟀', JSON.stringify(F4));

  // 点删除 → 确认
  await p.goto(BASE + '#/home', 1200);
  await p.goto(BASE + '#/logs', 2000);
  await sleep(900);
  await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#view .list .row')];
    const r = rows.find(x => x.textContent.includes('V31日志甲'));
    r.querySelector('[data-del]').click();
  })()`, { awaitPromise: false });
  await sleep(600);
  const F5 = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    return { title: m.querySelector('.m-title') ? m.querySelector('.m-title').textContent : '', hasDel: [...m.querySelectorAll('.m-foot .btn')].some(b => b.textContent === '删除') };
  })()`);
  ok('删除前弹出确认框', F5.title.includes('删除') && F5.hasDel === true, JSON.stringify(F5));
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    [...m.querySelectorAll('.m-foot .btn')].find(b => b.textContent === '删除').click();
  })()`, { awaitPromise: false });
  await sleep(900);
  const F6 = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.S.animal.find(x => x.name === 'V31日志甲');
    return { n: a ? s.listLogs(a.id, 'feed').length : -1 };
  })()`, { awaitPromise: true });
  ok('日志删除生效', F6.n === 0, String(F6.n));

  /* ===== G. 物种库页面：修改/删除按钮（内置无按钮） ===== */
  await p.goto(BASE + '#/species', 1800);
  await sleep(700);
  const G = await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#sp-list .row')];
    const builtin = rows.find(r => r.textContent.includes('睫角守宫'));
    const custom = rows.find(r => r.textContent.includes('自定义'));
    return {
      n: rows.length,
      builtinHasEdit: builtin ? !!builtin.querySelector('[data-edit]') : null,
      builtinHasDel: builtin ? !!builtin.querySelector('[data-del]') : null,
      customHasEdit: custom ? !!custom.querySelector('[data-edit]') : false,
      customHasDel: custom ? !!custom.querySelector('[data-del]') : false,
    };
  })()`);
  console.log('  ' + JSON.stringify(G));
  ok('物种库自定义物种有修改按钮', G.customHasEdit === true, JSON.stringify(G));
  ok('物种库自定义物种有删除按钮', G.customHasDel === true, JSON.stringify(G));
  ok('物种库内置物种无修改/删除按钮', G.builtinHasEdit === false && G.builtinHasDel === false, JSON.stringify(G));

  /* ===== H. 成长记录分页 + 翻页按钮 + 滑动 ===== */
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    for (let i = 0; i < 9; i++) {
      await s.createAnimal({ name: 'V31成长' + i + '${T}', speciesId: 'sp-crested', sex: 'male' });
    }
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/growth', 2000);
  await sleep(1000);
  const H1 = await p.eval(`(() => {
    const v = document.getElementById('view');
    return {
      cells: v.querySelectorAll('.growth-cell').length,
      pager: !!v.querySelector('.growth-pager'),
      info: v.querySelector('.growth-pager .gp-info') ? v.querySelector('.growth-pager .gp-info').textContent : '',
      nextBtn: !!v.querySelector('[data-gp="next"]'),
      prevBtn: !!v.querySelector('[data-gp="prev"]'),
      prevDisabled: v.querySelector('[data-gp="prev"]') ? v.querySelector('[data-gp="prev"]').disabled : null,
    };
  })()`);
  console.log('  ' + JSON.stringify(H1));
  ok('成长记录每页只显示 4 个个体', H1.cells === 4, String(H1.cells));
  ok('成长记录有翻页条与按钮', H1.pager === true && H1.nextBtn === true && H1.prevBtn === true, JSON.stringify(H1));
  ok('第 1 页上一页按钮禁用', H1.prevDisabled === true, String(H1.prevDisabled));

  // 点下一页
  await p.eval(`document.querySelector('[data-gp="next"]').click()`, { awaitPromise: false });
  await sleep(700);
  const H2 = await p.eval(`(() => {
    const v = document.getElementById('view');
    return {
      cells: v.querySelectorAll('.growth-cell').length,
      info: v.querySelector('.growth-pager .gp-info') ? v.querySelector('.growth-pager .gp-info').textContent : '',
      names: [...v.querySelectorAll('.growth-cell .gc-name')].map(c => c.textContent.trim()),
    };
  })()`);
  console.log('  ' + JSON.stringify(H2));
  ok('翻页后显示第 2 页', H2.info.includes('第 2 /'), H2.info);
  ok('第 2 页仍是 4 个个体', H2.cells === 4, String(H2.cells));

  // 模拟左滑 → 下一页
  const before = await p.eval(`document.querySelector('.growth-pager .gp-info').textContent`);
  await p.eval(`(() => {
    const grid = document.querySelector('.growth-grid');
    const mk = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: grid, clientX: x, clientY: y });
      grid.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
    };
    mk('touchstart', 300, 200);
    mk('touchend', 120, 205);
  })()`, { awaitPromise: false });
  await sleep(700);
  const after = await p.eval(`document.querySelector('.growth-pager .gp-info').textContent`);
  ok('手机端左滑翻到下一页', after !== before && after.includes('第 3 /'), `${before} → ${after}`);

  // 模拟右滑 → 上一页
  await p.eval(`(() => {
    const grid = document.querySelector('.growth-grid');
    const mk = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: grid, clientX: x, clientY: y });
      grid.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
    };
    mk('touchstart', 120, 200);
    mk('touchend', 300, 203);
  })()`, { awaitPromise: false });
  await sleep(700);
  const after2 = await p.eval(`document.querySelector('.growth-pager .gp-info').textContent`);
  ok('手机端右滑翻回上一页', after2.includes('第 2 /'), `${after} → ${after2}`);

  /* ===== I. 备份包含食物表 ===== */
  const I = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const pkg = s.buildBackup();
    return { hasFood: Array.isArray(pkg.tables.food), n: pkg.tables.food.length, total: Object.keys(pkg.tables).length };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(I));
  ok('备份包包含食物库表', I.hasFood === true && I.n > 0, JSON.stringify(I));
  ok('备份表数量为 13', I.total === 13, String(I.total));

  ok('控制台零错误', p.consoleErrors.length === 0, JSON.stringify(p.consoleErrors.slice(0, 4)));
}, { port: 9254 });

console.log(`\n汇总：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
