// verify-v32.mjs —— v3.2 五项修复专项验证
//   A. 成长记录：选中个体后翻页按钮 / 滑动翻页不再失效（原 bug：render 强制把页码拉回选中个体所在页）
//   B. 成长记录：滑动翻页有动画（跟手位移 + 滑入/滑出动画类）
//   C. 返回键：点缩略图放大后 __rbBack 优先关闭图片放大层（不后退路由、不退出）
//   D. 喂食记录：去掉「食物」文本输入框，只保留食物库下拉（编辑旧记录不丢食物）
//   E. 食物库搜索框：样式生效（胶囊圆角 + 计数提示）
import { withBrowser } from './cdp.mjs';
import { seedFixture } from './fixture.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3237';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};
const T = Date.now().toString(36).slice(-5);

await withBrowser(async (p) => {
  await p.goto(BASE + '#/home', 1500);
  await seedFixture(p);

  /* ===== A. 成长记录分页：选中个体后仍可翻页 ===== */
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    for (let i = 0; i < 9; i++) {
      await s.createAnimal({ name: 'V32成长' + i + '${T}', speciesId: 'sp-crested', sex: 'male' });
    }
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/growth', 2000);
  await sleep(1000);

  const A1 = await p.eval(`(() => {
    const v = document.getElementById('view');
    return {
      cells: v.querySelectorAll('.growth-cell').length,
      info: v.querySelector('.growth-pager .gp-info') ? v.querySelector('.growth-pager .gp-info').textContent : '',
      viewport: !!v.querySelector('.growth-viewport'),
    };
  })()`);
  console.log('  ' + JSON.stringify(A1));
  ok('成长记录每页 4 个 + 有视口容器', A1.cells === 4 && A1.viewport === true, JSON.stringify(A1));

  // 点第 1 页的一个个体（选中）
  await p.eval(`(() => {
    const c = document.querySelector('#view .growth-cell');
    c.click();
  })()`, { awaitPromise: false });
  await sleep(700);
  const A2 = await p.eval(`(() => {
    const v = document.getElementById('view');
    return {
      picked: v.querySelectorAll('.growth-cell.picked').length,
      info: v.querySelector('.growth-pager .gp-info') ? v.querySelector('.growth-pager .gp-info').textContent : '',
    };
  })()`);
  console.log('  ' + JSON.stringify(A2));
  ok('已选中个体（有 picked 标记）', A2.picked === 1, JSON.stringify(A2));

  // 关键回归：选中个体后点「下一页」按钮，页码必须真的变化
  await p.eval(`document.querySelector('#view [data-gp="next"]').click()`, { awaitPromise: false });
  await sleep(900);
  const A3 = await p.eval(`(() => {
    const v = document.getElementById('view');
    return {
      info: v.querySelector('.growth-pager .gp-info') ? v.querySelector('.growth-pager .gp-info').textContent : '',
      cells: v.querySelectorAll('.growth-cell').length,
    };
  })()`);
  console.log('  ' + JSON.stringify(A3));
  ok('选中个体后「下一页」按钮生效（不再被拽回第 1 页）', A3.info.includes('第 2 /'), A3.info);
  ok('第 2 页仍显示 4 个个体', A3.cells === 4, String(A3.cells));

  // 上一页按钮也应生效
  await p.eval(`document.querySelector('#view [data-gp="prev"]').click()`, { awaitPromise: false });
  await sleep(900);
  const A4 = await p.eval(`document.querySelector('#view .growth-pager .gp-info').textContent`);
  ok('选中个体后「上一页」按钮生效', A4.includes('第 1 /'), A4);

  /* ===== B. 滑动翻页 + 动画 ===== */
  const swipe = async (fromX, toX) => {
    await p.eval(`(() => {
      const grid = document.querySelector('#view .growth-grid');
      const mk = (type, x, y) => {
        const t = new Touch({ identifier: 1, target: grid, clientX: x, clientY: y });
        grid.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
      };
      mk('touchstart', ${fromX}, 200);
      mk('touchmove', ${(fromX + toX) / 2}, 202);
      mk('touchend', ${toX}, 205);
    })()`, { awaitPromise: false });
    await sleep(900);
    return p.eval(`document.querySelector('#view .growth-pager .gp-info').textContent`);
  };

  const b1 = await swipe(300, 120);   // 左滑 → 下一页
  console.log('  左滑后：' + b1);
  ok('手机端左滑翻到下一页', b1.includes('第 2 /'), b1);

  const b2 = await swipe(120, 300);   // 右滑 → 上一页
  console.log('  右滑后：' + b2);
  ok('手机端右滑翻回上一页', b2.includes('第 1 /'), b2);

  // 动画：翻页后新网格带 anim-in-* 类，且有 keyframes 定义
  const B3 = await p.eval(`(() => {
    const grid = document.querySelector('#view .growth-grid');
    const cls = grid ? grid.className : '';
    let hasKeyframes = false;
    try {
      hasKeyframes = !!(Array.from(document.styleSheets).some((ss) => {
        try { return Array.from(ss.cssRules).some(r => r.type === 7 && /gpSlideIn/.test(r.cssText)); }
        catch (e) { return false; }
      }));
    } catch (e) { hasKeyframes = false; }
    return { cls, hasKeyframes, hasTransition: getComputedStyle(grid).transitionDuration !== '0s' };
  })()`);
  console.log('  ' + JSON.stringify(B3));
  ok('滑动翻页带有动画类 / keyframes', B3.hasKeyframes === true, JSON.stringify(B3));

  // 跟手位移：touchmove 后网格应有 translateX
  const B4 = await p.eval(`(() => {
    const grid = document.querySelector('#view .growth-grid');
    const mk = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: grid, clientX: x, clientY: y });
      grid.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
    };
    mk('touchstart', 300, 200);
    mk('touchmove', 230, 202);
    const tf = grid.style.transform || '';
    mk('touchend', 230, 202);
    return { tf };
  })()`, { awaitPromise: false });
  console.log('  ' + JSON.stringify(B4));
  ok('滑动过程中网格跟手位移（translateX）', /translateX/.test(B4.tf), B4.tf);
  await sleep(700);

  /* ===== C. 返回键：优先关闭图片放大 ===== */
  const C1 = await p.eval(`(async () => {
    const m = await import('./js/lightbox.js');
    // 造一张可放大的图片
    const img = document.createElement('img');
    img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23f00"/></svg>';
    img.alt = 'V32测试图';
    document.getElementById('view').appendChild(img);
    img.click();
    await new Promise(r => setTimeout(r, 300));
    const open = !!document.querySelector('.zoom-viewer.open');
    const hasOverlayFn = typeof window.__rbHasOverlay === 'function' ? window.__rbHasOverlay() : 'missing';
    const hashBefore = location.hash;
    const back = window.__rbBack();
    await new Promise(r => setTimeout(r, 300));
    const stillOpen = !!document.querySelector('.zoom-viewer.open');
    return {
      open, hasOverlayFn, hashBefore, hashAfter: location.hash, back,
      stillOpen, hasOverlay: typeof window.__rbHasOverlay === 'function',
    };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(C1));
  ok('点击缩略图可打开图片放大层', C1.open === true, JSON.stringify(C1));
  ok('__rbHasOverlay 能识别放大层', C1.hasOverlayFn === 'yes', String(C1.hasOverlayFn));
  ok('返回键优先关闭图片放大（不后退路由）', C1.back === 'handled' && C1.stillOpen === false && C1.hashAfter === C1.hashBefore, JSON.stringify(C1));

  // 无浮层时返回键仍按「历史返回 → 回首页」工作
  const C2 = await p.eval(`(async () => {
    document.querySelectorAll('.zoom-viewer').forEach(z => z.remove());
    const has = window.__rbHasOverlay();
    return { has, hash: location.hash };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(C2));
  ok('关闭放大层后 __rbHasOverlay 返回 no', C2.has === 'no', String(C2.has));

  /* ===== D. 喂食记录：去掉食物文本输入框 ===== */
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = await s.createAnimal({ name: 'V32喂食${T}', speciesId: 'sp-crested', sex: 'male' });
    await s.addLog(a.id, 'feed', { food: '旧食物XYZ', qty: '1', ate: '吃完', note: '' });
  })()`, { awaitPromise: true });
  await p.goto(BASE + '#/logs', 2000);
  await sleep(900);
  await p.eval(`(() => {
    const rows = [...document.querySelectorAll('#view .list .row')];
    const r = rows.find(x => x.textContent.includes('V32喂食${T}'));
    r.querySelector('[data-edit]').click();
  })()`, { awaitPromise: false });
  await sleep(800);
  const D1 = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const pick = m.querySelector('#lg-food-pick');
    return {
      hasInput: !!m.querySelector('#lg-food'),
      hasPick: !!pick,
      pickValue: pick ? pick.value : '',
      opts: pick ? [...pick.options].map(o => o.value) : [],
      hasAddBtn: !!m.querySelector('#lg-foodlib-add'),
    };
  })()`);
  console.log('  ' + JSON.stringify(D1));
  ok('喂食表单不再有「食物」文本输入框', D1.hasInput === false, String(D1.hasInput));
  ok('喂食表单保留食物库下拉框', D1.hasPick === true, JSON.stringify(D1));
  ok('编辑时回填原食物（不在食物库也保留）', D1.pickValue === '旧食物XYZ', D1.pickValue);
  ok('食物库内置项在选项中', D1.opts.includes('白蟋蟀'), JSON.stringify(D1.opts));

  // 换食物并保存
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const pick = m.querySelector('#lg-food-pick');
    pick.value = '白蟋蟀';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    [...m.querySelectorAll('.m-foot .btn')].find(b => b.textContent === '保存').click();
  })()`, { awaitPromise: false });
  await sleep(900);
  const D2 = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const a = s.S.animal.find(x => x.name === 'V32喂食${T}');
    const logs = s.listLogs(a.id, 'feed');
    return { food: logs.length ? logs[0].data.food : '', n: logs.length };
  })()`, { awaitPromise: true });
  console.log('  ' + JSON.stringify(D2));
  ok('下拉选择的新食物已保存', D2.food === '白蟋蟀', JSON.stringify(D2));

  /* ===== E. 食物库搜索框样式 ===== */
  await p.eval(`document.getElementById('lg-foodlib').click()`, { awaitPromise: false });
  await sleep(700);
  const E1 = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const box = m.querySelector('.flq');
    const inp = m.querySelector('#fl-q');
    if (!box || !inp) return { missing: true };
    const cs = getComputedStyle(inp);
    return {
      missing: false,
      radius: cs.borderRadius,
      height: cs.height,
      hasCount: !!m.querySelector('#fl-count'),
      countTxt: m.querySelector('#fl-count') ? m.querySelector('#fl-count').textContent : '',
      hasClear: !!m.querySelector('#fl-q-clear'),
      ico: !!m.querySelector('.flq-ico'),
    };
  })()`);
  console.log('  ' + JSON.stringify(E1));
  ok('食物库搜索框使用新样式容器 .flq', E1.missing === false, JSON.stringify(E1));
  ok('搜索框为胶囊圆角', /999px|50%/.test(String(E1.radius)), String(E1.radius));
  ok('搜索框有计数提示行', E1.hasCount === true && /共 \d+ 种食物/.test(String(E1.countTxt)), String(E1.countTxt));
  ok('搜索框有搜索图标与清除按钮', E1.ico === true && E1.hasClear === true, JSON.stringify(E1));

  // 搜索过滤仍生效
  await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const q = m.querySelector('#fl-q');
    q.value = '白蟋蟀';
    q.dispatchEvent(new Event('input'));
  })()`, { awaitPromise: false });
  await sleep(400);
  const E2 = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    return {
      n: m.querySelectorAll('#fl-list .row').length,
      countTxt: m.querySelector('#fl-count') ? m.querySelector('#fl-count').textContent : '',
    };
  })()`);
  console.log('  ' + JSON.stringify(E2));
  ok('食物库搜索过滤仍生效', E2.n === 1, JSON.stringify(E2));
  ok('搜索时计数提示更新为「匹配 N / M」', /匹配 1 \//.test(String(E2.countTxt)), String(E2.countTxt));

  console.log('\n=== 控制台错误 ===');
  console.log(p.consoleErrors.length ? p.consoleErrors.join('\n') : '(无)');

  console.log(`\n=== 汇总: ${pass}/${pass + fail} 通过 ===`);
  if (fail) process.exitCode = 2;
});

process.exit(process.exitCode || 0);
