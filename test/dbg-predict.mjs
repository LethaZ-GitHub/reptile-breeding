// 调试：基因预测页（猪鼻蛇）实际渲染检查
import { spawn } from 'node:child_process';
import { withBrowser } from './cdp.mjs';

const PORT = 3242;
const server = spawn(process.execPath, ['server.js', `--port=${PORT}`], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));

await withBrowser(async (p) => {
  await p.setViewport(390, 844, false);
  await p.goto(`http://127.0.0.1:${PORT}/#/predict`);
  await new Promise((r) => setTimeout(r, 1000));

  // 选猪鼻蛇
  const opt = await p.eval(`(() => {
    const sel = document.getElementById('f-species');
    const o = [...sel.options].find(x => x.textContent.includes('猪鼻蛇'));
    sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return o.textContent;
  })()`);
  console.log('物种: ' + opt);
  await new Promise((r) => setTimeout(r, 600));

  // 公方基因下拉的选项
  const info = await p.eval(`(() => {
    const s = document.querySelector('#male-box .g-sel');
    return {
      isNativeSelect: !!s,
      options: s ? [...s.options].map(o => o.textContent) : [],
      pkBtn: !!document.querySelector('#male-box .pk-btn'),
      pkBtnText: (document.querySelector('#male-box .pk-btn')||{}).textContent || '',
    };
  })()`);
  console.log('公方下拉: ' + JSON.stringify(info, null, 1));

  // 打开 picker 面板看有无搜索框
  await p.eval(`(() => { const b = document.querySelector('#male-box .pk-btn'); if (b) b.click(); })()`);
  await new Promise((r) => setTimeout(r, 500));
  const sheet = await p.eval(`(() => {
    const sh = document.querySelector('.pk-sheet');
    return {
      exists: !!sh,
      hasSearch: !!(sh && sh.querySelector('input[type=search], input.sfl-q, .pk-search')),
      html: sh ? sh.innerHTML.slice(0, 400) : '',
      items: sh ? sh.querySelectorAll('.pk-item, .pk-opt, li').length : 0,
    };
  })()`);
  console.log('picker 面板: ' + JSON.stringify(sheet, null, 1));

  // 选「白化康达」做公方，「白化」做母方
  await p.eval(`(() => {
    const s = document.querySelector('#male-box .g-sel');
    s.value = [...s.options].find(o => o.textContent.includes('白化康达')).value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await p.eval(`(() => {
    const s = document.querySelector('#female-box .g-sel');
    s.value = [...s.options].find(o => o.textContent.includes('紫貂')).value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await p.eval(`(() => { document.getElementById('btn-run').click(); })()`);
  await new Promise((r) => setTimeout(r, 900));

  const res = await p.eval(`(() => {
    const m = [...document.querySelectorAll('.modal-mask')].pop();
    const t = m.querySelector('.gp-table');
    return {
      title: (m.querySelector('.m-title')||{}).textContent || '',
      rows: t ? [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [],
      pool: null,
    };
  })()`);
  console.log('结果表: ' + JSON.stringify(res, null, 1));

  // 基因库实际名称
  const lib = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    return s.listGenes('sp-hognose').map(g => g.name);
  })()`, { awaitPromise: true });
  console.log('基因库: ' + JSON.stringify(lib));
});

server.kill();
process.exit(0);
