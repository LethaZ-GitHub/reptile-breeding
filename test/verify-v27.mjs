// verify-v27.mjs —— v2.7 验证（手机适配 + 缺陷修复 + 导航调整）：
//   A. 谱系图：弹窗画布自适应容器宽度（手机 1:1 不挤压）；宽树加宽画布可横向滚动且节点不溢出 viewBox；
//      「放大查看」按钮移入工具条不遮挡节点；全屏放大后完整可见（不裁切）
//   B. 首页待办「查看关联」弹窗可弹出（修复 home.js 引用未定义变量导致点击无响应），
//      确认后仅同步配对记录、不完成待办
//   C. 新增配对记录：母本/父本下拉显示「名称（编号）· 基因」
//   D. 饲养日志搜索框：手机端不超出范围（input[type=search] 宽度收口），统一 .sf-wrap 模板
//   E. 新建个体表单：手机端同步桌面行式布局（物种+性别 / 基因+表现 / 体重+体长 / 购入+生日 /
//      爬箱+标签 / 父体+母体 / 价格+状态 各一行，名称/铲屎官/备注整行）
//   F. 设置页单位切换：点击后选中项高亮颜色跟随变化（修复模块级常量过期），主题按钮同样跟随
//   G. 导航：底部菜单「个体管理」「配对记录」；记账迁入更多页改名「记账报表」；
//      配对记录为一级页（无返回键），记账页归属「更多」高亮
import { withBrowser } from './cdp.mjs';

const BASE = 'http://127.0.0.1:3231/';
const R = [];
const ok = (n, c, d = '') => { R.push([n, c, d]); console.log((c ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };
const wait = (p, ms) => p.eval(`new Promise(r => setTimeout(r, ${ms}))`, { awaitPromise: true });
const T = String(Date.now()).slice(-6);

await withBrowser(async (p) => {
  await p.goto(BASE, 2500);

  /* ===== 准备数据 ===== */
  const seed = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const sp = s.listSpecies().find((x) => x.id === 'sp-crested');
    const gene = s.listGenes('sp-crested')[0];
    const d = new Date(); d.setDate(d.getDate() - 25); // 保证待办已到期，落在首页「到期」tab
    const pairDate = d.toISOString().slice(0, 10);
    // 四代链：kid ← (母,父) ← 双方父母（4 叶子宽树）
    const gm1 = await s.createAnimal({ name: 'V27祖母${T}', speciesId: 'sp-crested', sex: 'female', geneIds: [gene && gene.id].filter(Boolean) });
    const gf1 = await s.createAnimal({ name: 'V27祖父${T}', speciesId: 'sp-crested', sex: 'male' });
    const gm2 = await s.createAnimal({ name: 'V27外祖母${T}', speciesId: 'sp-crested', sex: 'female' });
    const gf2 = await s.createAnimal({ name: 'V27外祖父${T}', speciesId: 'sp-crested', sex: 'male' });
    const mother = await s.createAnimal({ name: 'V27母${T}', speciesId: 'sp-crested', sex: 'female', motherId: gm1.id, fatherId: gf1.id, geneIds: [gene && gene.id].filter(Boolean) });
    const father = await s.createAnimal({ name: 'V27父${T}', speciesId: 'sp-crested', sex: 'male', motherId: gm2.id, fatherId: gf2.id });
    const kid = await s.createAnimal({ name: 'V27仔${T}', speciesId: 'sp-crested', sex: 'male', motherId: mother.id, fatherId: father.id, geneIds: [gene && gene.id].filter(Boolean) });
    const kidNarrow = await s.createAnimal({ name: 'V27独苗${T}', speciesId: 'sp-crested', sex: 'female' });
    // 配对（自动为母本生成产卵检查待办，+20 天）
    const pairing = await s.createPairing({ participants: [mother.id, father.id], pairDate, result: 'pending', note: 'V27初始备注' });
    const todo = s.listAllTodos().find((t) => t.sourceType === 'pairing-check' && t.sourceId === pairing.id);
    return {
      mother: mother.id, father: father.id, kid: kid.id, kidNarrow: kidNarrow.id,
      motherCode: mother.code, geneName: gene ? gene.name : '',
      pairingId: pairing.id, todoId: todo ? todo.id : '', pairDate,
    };
  })()`, { awaitPromise: true });
  ok('准备数据：四代谱系链 + 配对记录 + 产卵检查待办', !!seed.pairingId && !!seed.todoId && !!seed.motherCode, JSON.stringify(seed));

  /* ===== A. 谱系图手机适配 ===== */
  await p.setViewport(390, 844);
  // A1. 窄树（无父母本，1 叶子）：画布=容器宽，1:1 渲染
  await p.goto(BASE + '#/animal/' + seed.kidNarrow, 1500);
  await wait(p, 400);
  const pedBtn = await p.eval(`(() => {
    const btn = document.getElementById('btn-pedigree');
    return { hasBtn: !!btn, isLastInRow: !!btn && btn.parentElement && btn.parentElement.lastElementChild === btn };
  })()`);
  ok('谱系入口在名字行最右侧', pedBtn.hasBtn && pedBtn.isLastInRow, JSON.stringify(pedBtn));

  await p.eval(`document.getElementById('btn-pedigree').click()`, { awaitPromise: false });
  await wait(p, 500);
  const pedNarrow = await p.eval(`(() => {
    const svg = document.getElementById('pedm-svg');
    if (!svg) return null;
    const wrap = document.getElementById('pedm-chart');
    const r = svg.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const vb = (svg.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
    return {
      vbW: vb[2], svgW: Math.round(r.width), wrapW: Math.round(wr.width),
      ratio: +(r.width / vb[2]).toFixed(3),
      inlineW: svg.style.width,
      scrollable: wrap.scrollWidth > wrap.clientWidth + 1,
    };
  })()`);
  ok('手机端窄树画布=容器宽，1:1 渲染不挤压（修复 680 宽 viewBox 被压成 0.47 倍）',
    !!pedNarrow && pedNarrow.vbW === pedNarrow.wrapW && pedNarrow.ratio >= 0.98 && pedNarrow.ratio <= 1.02 && !pedNarrow.scrollable,
    JSON.stringify(pedNarrow));
  await p.eval(`(() => { const c = document.querySelector('.modal .m-close'); if (c) c.click(); })()`);
  await wait(p, 300);

  // A2. 宽树（4 叶子）：加宽画布可横向滚动，节点不溢出 viewBox
  await p.goto(BASE + '#/animal/' + seed.kid, 1500);
  await wait(p, 400);
  await p.eval(`document.getElementById('btn-pedigree').click()`, { awaitPromise: false });
  await wait(p, 500);
  const pedMobile = await p.eval(`(() => {
    const svg = document.getElementById('pedm-svg');
    if (!svg) return null;
    const wrap = document.getElementById('pedm-chart');
    const r = svg.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const vb = (svg.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
    let maxRight = 0;
    svg.querySelectorAll('.ped-node rect').forEach((rc) => {
      const x = +rc.getAttribute('x'), w = +rc.getAttribute('width');
      if (x + w > maxRight) maxRight = x + w;
    });
    const zoomBtn = document.getElementById('pedm-zoom');
    return {
      vbW: vb[2], vbH: vb[3],
      svgW: Math.round(r.width), wrapW: Math.round(wr.width),
      inlineW: svg.style.width,
      scrollable: wrap.scrollWidth > wrap.clientWidth + 1,
      maxRight: Math.round(maxRight),
      nodeCount: svg.querySelectorAll('.ped-node').length,
      zoomInToolbar: !!zoomBtn && !!zoomBtn.closest('.ped-toolbar') && !zoomBtn.closest('.pedigree'),
    };
  })()`);
  ok('宽树（4 叶子）加宽画布：可横向滚动且节点不溢出 viewBox（修复右缘裁切）',
    !!pedMobile && pedMobile.scrollable === true && pedMobile.maxRight <= pedMobile.vbW + 1 && pedMobile.nodeCount >= 5,
    JSON.stringify(pedMobile));
  ok('「放大查看」按钮在工具条内（不再遮挡树图节点）',
    !!pedMobile && pedMobile.zoomInToolbar === true, JSON.stringify(pedMobile && pedMobile.zoomInToolbar));

  // 全屏放大：完整可见（不裁切）
  await p.eval(`document.getElementById('pedm-zoom').click()`, { awaitPromise: false });
  await wait(p, 500);
  const zoomMobile = await p.eval(`(() => {
    const zv = document.querySelector('.zoom-viewer');
    if (!zv || !zv.classList.contains('open')) return null;
    const svg = zv.querySelector('svg');
    const stage = zv.querySelector('.zv-stage');
    const r = svg.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      fitsW: r.right <= sr.right + 1, fitsH: r.bottom <= sr.bottom + 1,
      hasSize: r.width > 100 && r.height > 30,
    };
  })()`);
  ok('手机端放大后族谱完整可见（宽高均不超出舞台，修复「放大的图也不全」）',
    !!zoomMobile && zoomMobile.hasSize && zoomMobile.fitsW && zoomMobile.fitsH,
    JSON.stringify(zoomMobile));
  await p.eval(`(() => { const z = document.querySelector('.zoom-viewer .zv-close'); if (z) z.click(); })()`);
  await wait(p, 200);
  await p.eval(`(() => { const c = document.querySelector('.modal .m-close'); if (c) c.click(); })()`);
  await wait(p, 300);

  // 桌面端：容器更宽，画布取更大值（不低于桌面内容区宽度）
  await p.clearViewport();
  await p.goto(BASE + '#/animal/' + seed.kid, 1500);
  await p.eval(`document.getElementById('btn-pedigree').click()`, { awaitPromise: false });
  await wait(p, 500);
  const pedDesk = await p.eval(`(() => {
    const svg = document.getElementById('pedm-svg');
    if (!svg) return null;
    const wrap = document.getElementById('pedm-chart');
    const vb = (svg.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
    return { vbW: vb[2], wrapW: Math.round(wrap.getBoundingClientRect().width), inlineW: svg.style.width, scrollable: wrap.scrollWidth > wrap.clientWidth + 1 };
  })()`);
  ok('桌面端谱系画布随容器加宽（宽树滚动、窄树满宽）',
    !!pedDesk && pedDesk.vbW >= 380 && (pedDesk.inlineW === '100%' || pedDesk.scrollable),
    JSON.stringify(pedDesk));
  await p.eval(`(() => { const c = document.querySelector('.modal .m-close'); if (c) c.click(); })()`);
  await wait(p, 200);

  /* ===== B. 首页待办「查看关联」弹窗（修复点击无响应） ===== */
  await p.goto(BASE + '#/home', 1500);
  await wait(p, 500);
  const homeLink = await p.eval(`(() => {
    const a = document.querySelector('.todo-item [data-act="view-pair"]');
    return a ? { text: a.textContent.trim() } : null;
  })()`);
  ok('首页产卵检查待办有「查看关联」入口', !!homeLink, JSON.stringify(homeLink));

  await p.eval(`document.querySelector('.todo-item [data-act="view-pair"]').click()`, { awaitPromise: false });
  await wait(p, 500);
  const homeVm = await p.eval(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      title: (m.querySelector('.m-title') || {}).textContent,
      btns: [...m.querySelectorAll('.m-foot .btn')].map((b) => b.textContent),
      hasResult: !!m.querySelector('#pr-result'), hasNote: !!m.querySelector('#pr-note'),
      pairDate: (m.querySelector('.hint') || {}).textContent || '',
    };
  })()`);
  ok('首页「查看关联」点击后弹窗正常弹出（修复未定义变量导致的无响应）',
    !!homeVm && homeVm.title === '配对记录 · 产卵检查' && homeVm.hasResult && homeVm.hasNote
      && homeVm.btns.includes('确定') && homeVm.pairDate.includes(seed.pairDate),
    JSON.stringify(homeVm));

  await p.eval(`(() => {
    document.getElementById('pr-result').value = 'failed';
    document.getElementById('pr-note').value = 'V27关联备注${T}';
    [...document.querySelectorAll('.modal .m-foot .btn')].find((b) => b.textContent === '确定').click();
  })()`, { awaitPromise: false });
  await wait(p, 600);
  const afterView = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    const pr = s.S.pairing.find((x) => x.id === '${seed.pairingId}');
    const td = s.S.todo.find((x) => x.id === '${seed.todoId}');
    return {
      result: pr && pr.result, note: pr && pr.note,
      todoStatus: td && td.status,
      modalGone: !document.querySelector('.modal'),
    };
  })()`, { awaitPromise: true });
  ok('查看关联确认后：配对记录结果/备注已同步，待办未完成',
    afterView.result === 'failed' && afterView.note === `V27关联备注${T}` && afterView.todoStatus === 'pending' && afterView.modalGone,
    JSON.stringify(afterView));

  /* ===== C. 配对窗口父母本下拉：名称（编号）· 基因 ===== */
  await p.goto(BASE + '#/pairings', 1500);
  await wait(p, 400);
  await p.eval(`document.getElementById('btn-add').click()`, { awaitPromise: false });
  await wait(p, 400);
  const pairOpts = await p.eval(`(() => {
    const sp = document.getElementById('pr-species');
    const mo = [...document.getElementById('pr-mother').options].map((o) => o.textContent);
    const fa = [...document.getElementById('pr-father').options].map((o) => o.textContent);
    const hint = document.getElementById('pr-sp-hint').textContent;
    return { spVal: sp.value, mo, fa, hint };
  })()`);
  ok('配对窗口母本下拉显示「名称（编号）· 基因」',
    pairOpts.mo.some((t) => t.includes(`V27母${T}`) && t.includes(`（${seed.motherCode}）`) && t.includes(seed.geneName)),
    JSON.stringify(pairOpts.mo));
  ok('配对窗口父本下拉显示编号（基因可空）',
    pairOpts.fa.some((t) => t.includes(`V27父${T}`) && /（[A-Z]+-\d+）/.test(t)),
    JSON.stringify(pairOpts.fa));
  ok('提示文案显示当前物种可选母/父数量', /可选母本 \d+ 只 \/ 父本 \d+ 只/.test(pairOpts.hint), pairOpts.hint);
  await p.eval(`(() => { const c = document.querySelector('.modal .m-close'); if (c) c.click(); })()`);
  await wait(p, 200);

  /* ===== D. 日志搜索框手机适配 ===== */
  await p.setViewport(390, 844);
  await p.goto(BASE + '#/logs', 1500);
  await wait(p, 400);
  const sfMobile = await p.eval(`(() => {
    const inp = document.getElementById('lg-q');
    const field = document.querySelector('.sf-field');
    const wrap = document.querySelector('.sf-wrap');
    const ir = inp.getBoundingClientRect(), fr = field.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    return {
      type: inp.type,
      inField: ir.right <= fr.right + 1 && ir.left >= fr.left - 1,
      inWrap: ir.right <= wr.right + 1,
      docNoOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      hasIco: !!wrap.querySelector('.sf-ico'), hasClear: !!wrap.querySelector('.sf-clear'),
      pill: getComputedStyle(inp).borderRadius,
    };
  })()`);
  ok('手机端搜索框不超出字段/屏幕范围（修复 search 输入固有宽度撑破布局）',
    !!sfMobile && sfMobile.inField && sfMobile.inWrap && sfMobile.docNoOverflow,
    JSON.stringify(sfMobile));
  ok('搜索框为统一模板（图标 + 胶囊圆角 + 清除按钮）',
    !!sfMobile && sfMobile.hasIco && sfMobile.hasClear && parseInt(sfMobile.pill) >= 20,
    JSON.stringify(sfMobile));
  await p.clearViewport();

  /* ===== E. 新建个体表单手机端行式布局 ===== */
  await p.setViewport(390, 844);
  await p.goto(BASE + '#/animal/new', 1500);
  await wait(p, 500);
  const formM = await p.eval(`(() => {
    const grid = document.querySelector('.form-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns;
    const rowOf = (label) => {
      const f = [...document.querySelectorAll('.form-grid .field')].find((x) => (x.querySelector('label') || {}).textContent.includes(label));
      return f ? Math.round(f.getBoundingClientRect().top) : null;
    };
    const widthOf = (label) => {
      const f = [...document.querySelectorAll('.form-grid .field')].find((x) => (x.querySelector('label') || {}).textContent.includes(label));
      return f ? Math.round(f.getBoundingClientRect().width) : null;
    };
    const labelFs = (() => {
      const l = document.querySelector('.form-grid .field > label');
      return l ? getComputedStyle(l).fontSize : '';
    })();
    const sameRow = (a, b) => { const ra = rowOf(a), rb = rowOf(b); return ra !== null && rb !== null && Math.abs(ra - rb) <= 1; };
    return {
      trackCount: cols.split(/\\s+/).length,
      cols,
      rows: {
        speciesSex: sameRow('物种', '性别'),
        genePheno: sameRow('基因', '表现'),
        weightLength: sameRow('最近体重', '最近体长'),
        buyBirth: sameRow('购入日期', '生日'),
        cageTag: sameRow('所属爬箱', '全局标签'),
        parents: sameRow('父体', '母体'),
        priceStatus: sameRow('购入价格', '状态'),
      },
      nameFull: (() => {
        const gw = Math.round(grid.getBoundingClientRect().width);
        return widthOf('个体名称') >= gw - 2;
      })(),
      labelFs,
      docNoOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    };
  })()`);
  ok('手机端表单为双列行式布局（同步桌面行结构）',
    !!formM && formM.trackCount === 2 && formM.docNoOverflow,
    JSON.stringify({ cols: formM.cols, tracks: formM.trackCount }));
  ok('手机端各行成对：物种+性别 / 基因+表现 / 体重+体长 / 购入+生日 / 爬箱+标签 / 父体+母体 / 价格+状态',
    !!formM && Object.values(formM.rows).every(Boolean),
    JSON.stringify(formM.rows));
  ok('手机端名称/整行字段跨满两列', !!formM && formM.nameFull === true, JSON.stringify(formM.nameFull));
  await p.clearViewport();

  /* ===== F. 单位切换按钮颜色跟随 ===== */
  await p.goto(BASE + '#/settings', 1500);
  await wait(p, 400);
  // 解析 --brand 为 rgb 串（与 getComputedStyle(button).backgroundColor 同格式比较）
  const brandRgb = await p.eval(`(() => {
    const d = document.createElement('div');
    d.style.color = 'var(--brand)';
    document.body.appendChild(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  })()`);
  const segActive = (sel) => p.eval(`(() => {
    const box = document.getElementById('${sel}');
    const act = box.querySelector('button.active');
    return act ? { v: act.dataset.v, bg: getComputedStyle(act).backgroundColor } : null;
  })()`);
  const before = await segActive('u-weight');
  await p.eval(`document.querySelector('#u-weight button[data-v="oz"]').click()`, { awaitPromise: false });
  await wait(p, 600);
  const afterOz = await segActive('u-weight');
  ok('体重单位切换后选中高亮移动到「盎司」且为品牌色',
    !!before && before.v === 'g' && !!afterOz && afterOz.v === 'oz' && afterOz.bg === brandRgb,
    JSON.stringify({ before, afterOz, brandRgb }));
  const unitTxt = await p.eval(`document.getElementById('view').textContent`);
  ok('切换后当前单位文案同步为盎司', unitTxt.includes('盎司'), '');
  // 切回克，验证双向
  await p.eval(`document.querySelector('#u-weight button[data-v="g"]').click()`, { awaitPromise: false });
  await wait(p, 600);
  const afterG = await segActive('u-weight');
  ok('切回「克」后高亮回到克（按钮颜色双向跟随）',
    !!afterG && afterG.v === 'g' && afterG.bg === brandRgb, JSON.stringify(afterG));
  // 体长单位
  await p.eval(`document.querySelector('#u-length button[data-v="inch"]').click()`, { awaitPromise: false });
  await wait(p, 600);
  const afterInch = await segActive('u-length');
  ok('体长单位切换后高亮移动到「英寸」', !!afterInch && afterInch.v === 'inch', JSON.stringify(afterInch));
  await p.eval(`document.querySelector('#u-length button[data-v="cm"]').click()`, { awaitPromise: false });
  await wait(p, 500);
  // 主题按钮高亮跟随
  const themeBefore = await segActive('u-theme');
  await p.eval(`document.querySelector('#u-theme button[data-v="dark"]').click()`, { awaitPromise: false });
  await wait(p, 600);
  const themeAfter = await segActive('u-theme');
  ok('主题切换后高亮移动到「深色」',
    !!themeBefore && themeBefore.v === 'light' && !!themeAfter && themeAfter.v === 'dark',
    JSON.stringify({ themeBefore, themeAfter }));
  await p.eval(`document.querySelector('#u-theme button[data-v="light"]').click()`, { awaitPromise: false });
  await wait(p, 500);

  /* ===== G. 导航调整 ===== */
  await p.setViewport(390, 844);
  await p.goto(BASE + '#/home', 1500);
  await wait(p, 300);
  const bn = await p.eval(`(() => [...document.querySelectorAll('#bottomnav .bn-item')].map((x) => x.textContent.trim()))()`);
  // 中间「首页」为居中大按钮，只显示图标不显示文案；文案均带 emoji 图标前缀
  ok('底部菜单为：蛋管理 / 个体管理 / 首页(图标) / 配对记录 / 更多',
    bn.length === 5 && bn[0].includes('蛋管理') && bn[1].includes('个体管理')
      && !bn[2].includes('首页') && bn[3].includes('配对记录') && bn[4].includes('更多'),
    JSON.stringify(bn));

  // 配对记录是一级页：无返回按钮，底部「配对记录」高亮、「更多」不高亮
  await p.eval(`[...document.querySelectorAll('#bottomnav .bn-item')].find((x) => x.textContent.includes('配对记录')).click()`, { awaitPromise: false });
  await wait(p, 900);
  const pairNav = await p.eval(`(() => ({
    hash: location.hash,
    backHidden: document.getElementById('btn-back').hidden,
    pairActive: !!document.querySelector('#bottomnav .bn-item.active') && document.querySelector('#bottomnav .bn-item.active').textContent.includes('配对记录'),
  }))()`);
  ok('配对记录迁入底部菜单：一级页（无返回键）且底部高亮',
    pairNav.hash === '#/pairings' && pairNav.backHidden === true && pairNav.pairActive === true,
    JSON.stringify(pairNav));

  // 记账迁入更多页（改名记账报表），归属「更多」高亮
  await p.eval(`[...document.querySelectorAll('#bottomnav .bn-item')].find((x) => x.textContent.includes('更多')).click()`, { awaitPromise: false });
  await wait(p, 900);
  const moreCells = await p.eval(`(() => [...document.querySelectorAll('.more-cell')].map((c) => c.textContent.trim()))()`);
  ok('更多页含「记账报表」、不再含「配对记录」',
    moreCells.some((t) => t.includes('记账报表')) && !moreCells.some((t) => t.includes('配对记录')),
    JSON.stringify(moreCells));
  await p.eval(`[...document.querySelectorAll('.more-cell')].find((c) => c.textContent.includes('记账报表')).click()`, { awaitPromise: false });
  await wait(p, 900);
  const billNav = await p.eval(`(() => ({
    hash: location.hash,
    moreActive: !!document.querySelector('#bottomnav .bn-item.active') && document.querySelector('#bottomnav .bn-item.active').textContent.includes('更多'),
    title: (document.querySelector('#view .card h3, #view h2, #view h1') || {}).textContent || document.title,
  }))()`);
  ok('记账报表页归属「更多」高亮且页面可达',
    billNav.hash === '#/bills' && billNav.moreActive === true,
    JSON.stringify(billNav));
  await p.clearViewport();

  /* ===== 控制台错误 ===== */
  ok('控制台零错误', p.consoleErrors.length === 0, JSON.stringify(p.consoleErrors.slice(0, 3)));
}, { port: 9252 });

/* ---------- 汇总 ---------- */
const pass = R.filter(([, c]) => c).length;
console.log(`\\n验证结果：${pass}/${R.length} 通过` +
  (pass === R.length ? '，全部通过 ✅' : '，存在失败 ❌'));
R.filter(([, c]) => !c).forEach(([n, , d]) => console.log('  ❌ ' + n + (d ? ' — ' + d : '')));
process.exit(pass === R.length ? 0 : 1);
