// v3.2 手动截图核验：成长记录分页 + 滑动跟手动画
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { withBrowser } from './cdp.mjs';

const PORT = 3241;
const OUT = 'test/shots';
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['server.js', `--port=${PORT}`], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));

await withBrowser(async (p) => {
  await p.setViewport(390, 844, false);
  await p.goto(`http://127.0.0.1:${PORT}/#/growth`);

  // 灌 7 只个体，让分页有 2 页
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const sp = s.listSpecies();
    const gecko = sp.find(x => x.name.includes('睫角')) || sp[0];
    for (let i = 1; i <= 7; i++) {
      await s.createAnimal({ name: '分页甲' + i, speciesId: gecko.id, sex: i % 2 ? 'M' : 'F' });
    }
    return s.listAnimals().length;
  })()`, { awaitPromise: true });

  await p.goto(`http://127.0.0.1:${PORT}/#/home`);
  await p.goto(`http://127.0.0.1:${PORT}/#/growth`);
  await new Promise((r) => setTimeout(r, 1200));

  const info = await p.eval(`(() => {
    const g = document.querySelector('#g-grid');
    return {
      hasGrid: !!g,
      cells: g ? g.querySelectorAll('.growth-cell').length : 0,
      info: (document.querySelector('.gp-info') || {}).textContent || '',
    };
  })()`);
  console.log('初始: ' + JSON.stringify(info));
  await p.shot(`${OUT}/v32-growth-p1.png`);

  // 点选第 1 个个体（模拟用户选中）
  await p.eval(`(() => { document.querySelector('#g-grid .growth-cell').click(); })()`);
  await new Promise((r) => setTimeout(r, 700));

  // 点下一页按钮
  await p.eval(`(() => { document.querySelector('[data-gp="next"]').click(); })()`);
  await new Promise((r) => setTimeout(r, 900));
  const after = await p.eval(`(() => ({
    info: (document.querySelector('.gp-info') || {}).textContent || '',
    animCls: (document.querySelector('#g-grid') || {}).className || '',
  }))()`);
  console.log('按钮翻页后: ' + JSON.stringify(after));
  await p.shot(`${OUT}/v32-growth-p2.png`);

  // 模拟跟手滑动：touchstart → touchmove（不抬手，截图看位移）
  await p.eval(`(() => {
    const g = document.querySelector('#g-grid');
    const mk = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: g, clientX: x, clientY: y });
      return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true });
    };
    g.dispatchEvent(mk('touchstart', 320, 400));
    g.dispatchEvent(mk('touchmove', 250, 402));
    g.dispatchEvent(mk('touchmove', 180, 404));
    return true;
  })()`);
  const mid = await p.eval(`(() => {
    const g = document.querySelector('#g-grid');
    return { transform: g.style.transform, transition: g.style.transition };
  })()`);
  console.log('滑动跟手: ' + JSON.stringify(mid));
  await p.shot(`${OUT}/v32-growth-swipe.png`);

  // 抬手 → 判定翻页
  await p.eval(`(() => {
    const g = document.querySelector('#g-grid');
    const t = new Touch({ identifier: 1, target: g, clientX: 180, clientY: 404 });
    g.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  const end = await p.eval(`(() => ({
    info: (document.querySelector('.gp-info') || {}).textContent || '',
    animCls: (document.querySelector('#g-grid') || {}).className || '',
  }))()`);
  console.log('滑动翻页后: ' + JSON.stringify(end));
  await p.shot(`${OUT}/v32-growth-swiped.png`);
  console.log('screenshots done');
});

server.kill();
process.exit(0);
