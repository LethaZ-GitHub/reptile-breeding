// verify-v26.mjs —— v2.6 验证：
//   A. 待办「查看关联」：产卵检查待办弹出配对记录弹窗（时间/物种/父母本只读 + 结果/备注可改），
//      确认后仅同步配对记录、不完成待办；首页待办行同样入口
//   B. 待办完成流程：产卵检查待办「完成」先登记配对结果（complete 模式）→ 同步配对记录并完成待办
//   C. 配对窗口：物种下拉 + 母本/父本按物种与性别过滤 + 物种切换清空失效预选 + 提示文案
//   D. 饲养日志搜索框美化（.sf-wrap：图标 + 胶囊输入 + 清除按钮）与清空交互
//   E. 首页喂养记录多选：直接点复选框显示已选中（修复 preventDefault 撤销勾选）+ 全选/取消全选
//   F. 工单管理入口迁移：首页工单列表 card-head 最右侧按钮可跳转；更多页与侧栏均无入口
//   G. 设置页：体重单位默认克高亮；无「报表统计」「测试数据」卡片
//   H. 新建个体表单布局重排（名称/物种性别/基因表现/体重体长/购入生日/爬箱标签/父母/价格状态/铲屎官/备注），无基因状态控件
import { withBrowser } from './cdp.mjs';

const BASE = 'http://127.0.0.1:3230/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2500);

  /* ===== 准备数据：母/父（睫角）+ 蛇母/父（猪鼻）+ 3 只在养个体 ===== */
  const seed = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const sp1 = s.listSpecies().find((x) => x.id === 'sp-crested');
    const sp2 = s.listSpecies().find((x) => x.id === 'sp-hognose');
    const mother = await s.createAnimal({ name: 'V26母${T}', speciesId: 'sp-crested', sex: 'female' });
    const father = await s.createAnimal({ name: 'V26父${T}', speciesId: 'sp-crested', sex: 'male' });
    const snakeF = await s.createAnimal({ name: 'V26蛇母${T}', speciesId: 'sp-hognose', sex: 'female' });
    const snakeM = await s.createAnimal({ name: 'V26蛇父${T}', speciesId: 'sp-hognose', sex: 'male' });
    const act = [];
    for (let i = 0; i < 3; i++) act.push(await s.createAnimal({ name: 'V26在养${T}-' + i, speciesId: 'sp-crested', sex: i === 0 ? 'female' : 'male' }));
    // 配对（自动为母本生成产卵检查待办，+20 天）
    const pairing = await s.createPairing({ participants: [mother.id, father.id], pairDate: '2026-10-01', result: 'pending', note: 'V26初始备注' });
    const todo = s.listAllTodos().find((t) => t.sourceType === 'pairing-check' && t.sourceId === pairing.id);
    // 一条带唯一关键词的喂食日志
    await s.addLog(act[0].id, 'feed', { food: 'V26搜索目标饲料${T}', amount: 2 });
    return {
      mother: mother.id, father: father.id, snakeF: snakeF.id, snakeM: snakeM.id,
      motherName: mother.name, fatherName: father.name,
      snakeFName: snakeF.name, snakeMName: snakeM.name,
      sp1: sp1 ? sp1.id : '', sp2: sp2 ? sp2.id : '',
      actIds: act.map((a) => a.id),
      pairingId: pairing.id, todoId: todo ? todo.id : '',
      pairingDate: pairing.pairDate,
    };
  })()`, { awaitPromise: true });
  ok('准备数据：配对记录与产卵检查待办已生成', !!seed.pairingId && !!seed.todoId, JSON.stringify({ pairingId: seed.pairingId, todoId: seed.todoId }));

  /* ===== A. 待办「查看关联」弹窗（view 模式） ===== */
  await p.goto(BASE + '#/todos', 1200);
  await wait(p, 500);
  const linkInfo = await p.eval(`(() => {
    const row = document.querySelector('.todo-item[data-id="${seed.todoId}"]');
    if (!row) return null;
    const a = row.querySelector('[data-act="view-pair"]');
    return a ? { text: a.textContent.trim(), href: a.getAttribute('href'), srcLabel: (row.querySelector('.tk-src') || {}).textContent } : null;
  })()`);
  ok('产卵检查待办行有「查看关联」链接（javascript: 伪协议，不跳页）',
    !!linkInfo && linkInfo.text === '查看关联 →' && linkInfo.href === 'javascript:void(0)' && linkInfo.srcLabel === '产卵检查',
    JSON.stringify(linkInfo));

  await p.eval(`document.querySelector('.todo-item[data-id="${seed.todoId}"] [data-act="view-pair"]').click()`, { awaitPromise: false });
  await wait(p, 400);
  const vm = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const rows = [...m.querySelectorAll('.cage-preview .pv-row')].map((r) => ({
      k: (r.querySelector('.k') || {}).textContent, v: r.textContent.replace(/^(物种|母本|父本|其他参与)/, '').trim(),
    }));
    const btns = [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent);
    return {
      title: (m.querySelector('.m-title') || {}).textContent,
      hint: (m.querySelector('.hint') || {}).textContent || '',
      rows, btns,
      hasResult: !!m.querySelector('#pr-result'), hasNote: !!m.querySelector('#pr-note'),
      txt: m.innerText,
    };
  })()`);
  ok('查看关联弹窗标题为「配对记录 · 产卵检查」', !!vm && vm.title === '配对记录 · 产卵检查', vm && vm.title);
  ok('弹窗只读展示配对日期 / 物种 / 母本 / 父本',
    !!vm && /配对日期 2026-10-01/.test(vm.hint) && vm.rows.length >= 3 &&
    vm.rows[0].k === '物种' && vm.rows[1].k === '母本' && vm.rows[2].k === '父本' &&
    vm.rows[1].v.includes(seed.motherName) && vm.rows[2].v.includes(seed.fatherName),
    JSON.stringify(vm && vm.rows));
  ok('弹窗含可修改的配对结果下拉与备注输入 + 「确定」按钮',
    !!vm && vm.hasResult && vm.hasNote && vm.btns.includes('确定'), JSON.stringify(vm && vm.btns));

  // 改结果与备注 → 确定 → 仅同步配对记录，待办仍待办
  await p.eval(`(() => {
    const rs = document.getElementById('pr-result');
    rs.value = 'failed';
    document.getElementById('pr-note').value = 'V26关联备注${T}';
    [...document.querySelectorAll('.modal .m-foot .btn')].find((b) => b.textContent === '确定').click();
  })()`, { awaitPromise: false });
  await wait(p, 600);
  const afterView = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const pr = s.getPairing('${seed.pairingId}');
    const td = s.listAllTodos().find((t) => t.id === '${seed.todoId}');
    return { result: pr && pr.result, note: pr && pr.note, todoStatus: td && td.status, modalGone: !document.querySelector('.modal') };
  })()`, { awaitPromise: true });
  ok('查看关联确认后：配对记录结果/备注已同步，待办未完成',
    afterView.result === 'failed' && afterView.note === `V26关联备注${T}` && afterView.todoStatus === 'pending' && afterView.modalGone,
    JSON.stringify(afterView));

  /* ===== B. 完成流程（complete 模式）：登记结果 → 同步 + 完成待办 ===== */
  await p.eval(`document.querySelector('.todo-item[data-id="${seed.todoId}"] [data-act="done"]').click()`, { awaitPromise: false });
  await wait(p, 400);
  const cm = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      title: (m.querySelector('.m-title') || {}).textContent,
      btns: [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent),
      resultVal: (document.getElementById('pr-result') || {}).value,
      noteVal: (document.getElementById('pr-note') || {}).value,
    };
  })()`);
  ok('完成产卵检查待办弹出「登记配对结果」（complete 模式，按钮为保存并完成）',
    !!cm && cm.title === '登记配对结果' && cm.btns.includes('保存并完成') && cm.resultVal === 'failed' && cm.noteVal === `V26关联备注${T}`,
    JSON.stringify(cm));
  await p.eval(`(() => {
    const rs = document.getElementById('pr-result');
    rs.value = 'success';
    document.getElementById('pr-note').value = 'V26完成备注${T}';
    [...document.querySelectorAll('.modal .m-foot .btn')].find((b) => b.textContent === '保存并完成').click();
  })()`, { awaitPromise: false });
  await wait(p, 700);
  const afterDone = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const pr = s.getPairing('${seed.pairingId}');
    const td = s.listAllTodos().find((t) => t.id === '${seed.todoId}');
    return { result: pr && pr.result, note: pr && pr.note, todoStatus: td && td.status };
  })()`, { awaitPromise: true });
  ok('保存并完成：配对记录同步为 success，待办完成',
    afterDone.result === 'success' && afterDone.note === `V26完成备注${T}` && afterDone.todoStatus === 'done',
    JSON.stringify(afterDone));

  /* ===== C. 配对窗口：物种下拉 + 父母本按物种性别过滤 ===== */
  await p.goto(BASE + '#/pairings', 1200);
  await wait(p, 500);
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  await wait(p, 400);
  const pm = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    const sp = document.getElementById('pr-species');
    return {
      hasSpecies: !!sp, hasMother: !!document.getElementById('pr-mother'), hasFather: !!document.getElementById('pr-father'),
      hasHint: !!document.getElementById('pr-sp-hint'),
      spOpts: sp ? [...sp.options].map((o) => o.value) : [],
    };
  })()`);
  ok('新增配对窗口含物种 / 母本 / 父本三个下拉', !!pm && pm.hasSpecies && pm.hasMother && pm.hasFather && pm.hasHint, JSON.stringify(pm));
  ok('物种下拉包含全部物种', !!pm && pm.spOpts.includes(seed.sp1) && pm.spOpts.includes(seed.sp2), JSON.stringify(pm && pm.spOpts));

  // 切到 sp-crested：母本仅母、父本仅公
  await p.eval(`(() => {
    const sp = document.getElementById('pr-species');
    sp.value = '${seed.sp1}';
    sp.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 300);
  const f1 = await p.eval(`(() => {
    const mo = [...document.getElementById('pr-mother').options].map((o) => o.textContent);
    const fa = [...document.getElementById('pr-father').options].map((o) => o.textContent);
    const hint = document.getElementById('pr-sp-hint').textContent;
    return { mo, fa, hint };
  })()`);
  ok('物种=睫角守宫：母本下拉仅母性个体（含 V26母，无 V26蛇母）',
    f1.mo.some((t) => t.includes(seed.motherName)) && !f1.mo.some((t) => t.includes('蛇母')), JSON.stringify(f1.mo));
  ok('物种=睫角守宫：父本下拉仅雄性个体（含 V26父，无 V26蛇母）',
    f1.fa.some((t) => t.includes(seed.fatherName)) && !f1.fa.some((t) => t.includes('蛇母')) && !f1.fa.some((t) => t.includes(seed.motherName)), JSON.stringify(f1.fa));
  ok('提示文案显示当前物种可选母/父数量', /可选母本 \d+ 只 \/ 父本 \d+ 只/.test(f1.hint), f1.hint);

  // 切到 sp-hognose：预选清空，仅剩蛇母/蛇父
  await p.eval(`(() => {
    const mo = document.getElementById('pr-mother');
    mo.value = '${seed.mother}';
    mo.dispatchEvent(new Event('change'));
    const sp = document.getElementById('pr-species');
    sp.value = '${seed.sp2}';
    sp.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 300);
  const f2 = await p.eval(`(() => ({
    mo: [...document.getElementById('pr-mother').options].map((o) => o.value),
    fa: [...document.getElementById('pr-father').options].map((o) => o.value),
    hint: document.getElementById('pr-sp-hint').textContent,
  }))()`);
  ok('切换物种后母本/父本预选清空（不保留跨物种个体）',
    !f2.mo.includes(seed.mother) && !f2.fa.includes(seed.father), JSON.stringify(f2));
  ok('物种=猪鼻蛇：母本仅蛇母、父本仅蛇父',
    f2.mo.includes(seed.snakeF) && f2.fa.includes(seed.snakeM) && !f2.mo.includes(seed.snakeM) && !f2.fa.includes(seed.snakeF),
    JSON.stringify(f2));

  // 选母/父保存 → 配对记录 participants=[母,父]，并为母本生成待办
  await p.eval(`(() => {
    const mo = document.getElementById('pr-mother');
    mo.value = '${seed.snakeF}';
    mo.dispatchEvent(new Event('change'));
    const fa = document.getElementById('pr-father');
    fa.value = '${seed.snakeM}';
    fa.dispatchEvent(new Event('change'));
    document.getElementById('pr-date').value = '2026-10-05';
    document.getElementById('pr-note').value = 'V26窗口保存${T}';
    [...document.querySelectorAll('.modal .m-foot .btn')].find((b) => b.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await wait(p, 800);
  const created = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const pr = s.listPairings().find((x) => (x.note || '').includes('V26窗口保存${T}'));
    const td = pr ? s.listAllTodos().find((t) => t.sourceType === 'pairing-check' && t.sourceId === pr.id) : null;
    return pr ? { parts: pr.participants, pairDate: pr.pairDate, todoForMother: !!td, todoTitle: td && td.title } : null;
  })()`, { awaitPromise: true });
  ok('窗口保存：participants=[母本,父本] 且为母本生成产卵检查待办',
    !!created && created.parts.length === 2 && created.parts[0] === seed.snakeF && created.parts[1] === seed.snakeM && created.todoForMother && (created.todoTitle || '').includes(seed.snakeFName),
    JSON.stringify(created));

  /* ===== D. 饲养日志搜索框美化 ===== */
  await p.goto(BASE + '#/logs', 1200);
  await wait(p, 600);
  const sf = await p.eval(`(() => {
    const wrap = document.querySelector('.sf-wrap');
    const clear = document.getElementById('lg-q-clear');
    return {
      hasWrap: !!wrap, hasIco: !!wrap && !!wrap.querySelector('.sf-ico'),
      hasInput: !!document.getElementById('lg-q'),
      clearExists: !!clear,
      clearHidden: clear ? getComputedStyle(clear).display === 'none' : null,
      inputType: (document.getElementById('lg-q') || {}).type,
    };
  })()`);
  ok('日志搜索框为美化结构（图标 + 搜索输入 + 清除按钮）',
    sf.hasWrap && sf.hasIco && sf.hasInput && sf.clearExists && sf.clearHidden === true && sf.inputType === 'search',
    JSON.stringify(sf));
  // 输入关键词 → 筛选 + 清除按钮可见
  await p.eval(`(() => {
    const q = document.getElementById('lg-q');
    q.value = 'V26搜索目标饲料${T}';
    q.dispatchEvent(new Event('change'));
  })()`, { awaitPromise: false });
  await wait(p, 700);
  const sf2 = await p.eval(`(() => {
    const clear = document.getElementById('lg-q-clear');
    const rows = [...document.querySelectorAll('.row .row-sub')].map((r) => r.textContent);
    return { clearVisible: clear ? getComputedStyle(clear).display !== 'none' : false, rows };
  })()`);
  ok('输入关键词后列表按关键词过滤且清除按钮可见',
    sf2.clearVisible && sf2.rows.length >= 1 && sf2.rows.every((t) => t.includes(`V26搜索目标饲料${T}`)),
    JSON.stringify(sf2));
  // 点清除 → 清空 + 按钮重新隐藏
  await p.eval(`document.getElementById('lg-q-clear').click()`, { awaitPromise: false });
  await wait(p, 700);
  const sf3 = await p.eval(`(() => {
    const clear = document.getElementById('lg-q-clear');
    const q = document.getElementById('lg-q');
    const rows = [...document.querySelectorAll('.row .row-sub')].map((r) => r.textContent);
    return { q: q ? q.value : null, clearHidden: clear ? getComputedStyle(clear).display === 'none' : null, rows: rows.length };
  })()`);
  ok('点击清除按钮：搜索词清空、按钮重新隐藏、列表恢复',
    sf3.q === '' && sf3.clearHidden === true && sf3.rows >= 1, JSON.stringify(sf3));

  /* ===== E. 首页喂养记录多选：复选框修复 + 全选 ===== */
  await p.goto(BASE, 1200);
  await wait(p, 600);
  await p.eval(`document.getElementById('btn-feeding').click()`, { awaitPromise: false });
  await wait(p, 400);
  await p.eval(`document.getElementById('ff-feed').click()`, { awaitPromise: false });
  await wait(p, 500);
  const pickOpen = await p.eval(`(() => ({
    list: !!document.getElementById('ff-list'),
    rows: document.querySelectorAll('#ff-list .pick-row').length,
    selall: !!document.getElementById('ff-selall'),
    selallText: (document.getElementById('ff-selall') || {}).textContent,
  }))()`);
  ok('喂食多选弹窗打开：个体列表 + 全选按钮', pickOpen.list && pickOpen.rows >= 3 && pickOpen.selall, JSON.stringify(pickOpen));

  // 直接点击第一行的复选框本体 → 应显示已选中（修复 preventDefault 撤销勾选）
  await p.eval(`document.querySelector('#ff-list .pick-row input[type=checkbox]').click()`, { awaitPromise: false });
  await wait(p, 300);
  const cb1 = await p.eval(`(() => {
    const row = document.querySelector('#ff-list .pick-row');
    const cb = row.querySelector('input');
    return { checked: cb.checked, picked: row.classList.contains('picked'), count: (document.getElementById('ff-count') || {}).textContent };
  })()`);
  ok('直接点复选框：显示已选中且行高亮、计数+1（修复点击不显示已选中）',
    cb1.checked === true && cb1.picked === true && cb1.count === '1', JSON.stringify(cb1));

  // 再点一次复选框 → 取消选中（change 驱动， toggle 正确）
  await p.eval(`document.querySelector('#ff-list .pick-row input[type=checkbox]').click()`, { awaitPromise: false });
  await wait(p, 300);
  const cb1b = await p.eval(`(() => {
    const row = document.querySelector('#ff-list .pick-row');
    const cb = row.querySelector('input');
    return { checked: cb.checked, picked: row.classList.contains('picked'), count: (document.getElementById('ff-count') || {}).textContent };
  })()`);
  ok('再点复选框：取消选中且计数归零', cb1b.checked === false && cb1b.picked === false && cb1b.count === '0', JSON.stringify(cb1b));

  // 点击行体（label 非复选框区）→ 同样生效（修复 label 转发双触发抵消）
  await p.eval(`document.querySelector('#ff-list .pick-row .pr-name').click()`, { awaitPromise: false });
  await wait(p, 300);
  const cb2 = await p.eval(`(() => {
    const row = document.querySelector('#ff-list .pick-row');
    const cb = row.querySelector('input');
    return { checked: cb.checked, picked: row.classList.contains('picked'), count: (document.getElementById('ff-count') || {}).textContent };
  })()`);
  ok('点击行体（非复选框区）：显示已选中且计数+1（label 转发不双触发）',
    cb2.checked === true && cb2.picked === true && cb2.count === '1', JSON.stringify(cb2));

  // 全选 → 全部勾选、按钮变「取消全选」
  await p.eval(`document.getElementById('ff-selall').click()`, { awaitPromise: false });
  await wait(p, 300);
  const cbAll = await p.eval(`(() => {
    const cbs = [...document.querySelectorAll('#ff-list .pick-row input')];
    return {
      all: cbs.length, on: cbs.filter((c) => c.checked).length,
      text: (document.getElementById('ff-selall') || {}).textContent,
      count: (document.getElementById('ff-count') || {}).textContent,
    };
  })()`);
  ok('全选按钮：全部勾选且文案变「取消全选」',
    cbAll.all >= 3 && cbAll.on === cbAll.all && cbAll.text === '☑ 取消全选' && String(cbAll.count) === String(cbAll.all),
    JSON.stringify(cbAll));
  // 再点 → 全部取消
  await p.eval(`document.getElementById('ff-selall').click()`, { awaitPromise: false });
  await wait(p, 300);
  const cbNone = await p.eval(`(() => {
    const cbs = [...document.querySelectorAll('#ff-list .pick-row input')];
    return { on: cbs.filter((c) => c.checked).length, text: (document.getElementById('ff-selall') || {}).textContent };
  })()`);
  ok('再点全选按钮：全部取消勾选且文案恢复「全选」', cbNone.on === 0 && cbNone.text === '☑ 全选', JSON.stringify(cbNone));
  // 关闭弹窗（不记录）
  await p.eval(`(() => { const b = [...document.querySelectorAll('.modal-mask .m-foot .btn')].find((x) => x.textContent === '取消'); if (b) b.click(); })()`, { awaitPromise: false });
  await wait(p, 300);

  /* ===== F. 工单管理入口迁移 ===== */
  const todoEntry = await p.eval(`(() => {
    const head = [...document.querySelectorAll('.card-head')].find((h) => (h.querySelector('h3') || {}).textContent === '工单列表');
    if (!head) return null;
    const btn = document.getElementById('btn-goto-todos');
    return {
      inHead: !!btn && head.contains(btn),
      isLast: btn ? head.lastElementChild === btn : false,
      text: btn ? btn.textContent.trim() : '',
    };
  })()`);
  ok('首页工单列表 card-head 最右侧有「工单管理」按钮',
    !!todoEntry && todoEntry.inHead && todoEntry.isLast && todoEntry.text === '📋 工单管理', JSON.stringify(todoEntry));
  await p.eval(`document.getElementById('btn-goto-todos').click()`, { awaitPromise: false });
  await wait(p, 800);
  const navOk = await p.eval(`({ hash: location.hash, title: document.title })`);
  ok('点击「工单管理」跳转工单管理页', navOk.hash === '#/todos' && navOk.title.includes('工单管理'), JSON.stringify(navOk));
  // v3.3：电脑端导航补齐全部功能入口，「工单管理」重新出现在更多页与侧栏
  await p.goto(BASE + '#/more', 1200);
  await wait(p, 500);
  const moreGone = await p.eval(`(() => {
    const txt = document.getElementById('view').textContent;
    const cells = [...document.querySelectorAll('.more-cell')].map((x) => x.textContent.trim());
    const sb = [...document.querySelectorAll('.sb-item')].map((x) => x.textContent.trim());
    return {
      moreHas: txt.includes('工单管理'),
      cellHas: cells.some((t) => t.includes('工单管理')),
      sbHas: sb.some((t) => t.includes('工单管理')),
      sbRoutes: [...document.querySelectorAll('.sb-item')].map((x) => x.dataset.route || ''),
    };
  })()`);
  ok('更多页与侧栏均已有「工单管理」入口（v3.3 导航补齐）',
    moreGone.moreHas && moreGone.cellHas && moreGone.sbHas && moreGone.sbRoutes.includes('#/todos'),
    JSON.stringify(moreGone));

  /* ===== G. 设置页：默认克 + 卡片删除 ===== */
  await p.goto(BASE + '#/settings', 1200);
  await wait(p, 500);
  const setUi = await p.eval(`(() => {
    const g = document.querySelector('#u-weight button[data-v="g"]');
    const oz = document.querySelector('#u-weight button[data-v="oz"]');
    const txt = document.getElementById('view').textContent;
    return { gActive: !!(g && g.classList.contains('active')), ozActive: !!(oz && oz.classList.contains('active')), txt };
  })()`);
  ok('设置页体重单位默认克（g 高亮、盎司不高亮）', setUi.gActive === true && setUi.ozActive === false, JSON.stringify({ gActive: setUi.gActive, ozActive: setUi.ozActive }));
  ok('设置页无「报表统计」「测试数据」卡片', !setUi.txt.includes('报表统计') && !setUi.txt.includes('测试数据'), '');

  /* ===== H. 新建个体表单布局 ===== */
  await p.goto(BASE + '#/animal/new', 1200);
  await wait(p, 600);
  const form = await p.eval(`(() => ({
    labels: [...document.querySelectorAll('.form-grid .field label')].map((l) => l.textContent.trim()),
    spans: [...document.querySelectorAll('.form-grid .field')].map((f) => f.classList.contains('span2') ? 2 : 1),
    hasState: !!document.getElementById('f-gene-state-wrap') || !!document.getElementById('f-gene-state'),
    ids: [...document.querySelectorAll('.form-grid .field')].map((f) => { const c = f.querySelector('input,select,textarea'); return c ? c.id : ''; }),
  }))()`);
  const expectLabels = ['个体名称*', '物种*', '性别', '基因（仅可从基因库选择）', '表现（可选）',
    '最近体重（g）', '最近体长（cm）', '购入日期', '生日 / 出壳日期', '所属爬箱', '全局标签',
    '父体', '母体', '购入价格（元）', '状态', '售出金额（元）', '售出日期', '铲屎官', '备注'];
  // 基因字段标签文案曾含「单选，」前缀（v2.6 → v2.8），按「仅可从基因库选择」核心文案匹配
  const labelOk = form.labels.length === expectLabels.length
    && form.labels.every((l, i) => (i === 3 ? l.includes('仅可从基因库选择') : l === expectLabels[i]));
  ok('表单字段按新布局排列（名称/物种性别/基因表现/体重体长/购入生日/爬箱标签/父母/价格状态/铲屎官/备注）',
    labelOk, labelOk ? '' : JSON.stringify(form.labels));
  ok('表单无基因状态控件（v2.6 废止）', form.hasState === false, '');
  ok('名称/铲屎官/备注占整行（span2），其余各占半行',
    form.spans[0] === 2 && form.spans[17] === 2 && form.spans[18] === 2 && form.spans.slice(1, 17).every((s) => s === 1),
    JSON.stringify(form.spans));
  ok('表单控件 id 齐全（基因单选 + 父母本下拉）',
    form.ids.includes('f-gene-sel') && form.ids.includes('f-mother') && form.ids.includes('f-father'), JSON.stringify(form.ids));

  /* ===== 汇总 ===== */
  const pass = R.filter(([, c]) => c).length;
  console.log(`\\n===== 验证结果：${pass}/${R.length} 通过 =====`);
  if (pass !== R.length) { console.log('FAILED: ' + R.filter(([, c]) => !c).map(([n]) => n).join(' | ')); process.exit(1); }
  console.log('ALL PASSED');
});
