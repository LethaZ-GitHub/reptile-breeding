import { spawn } from 'node:child_process';
import { withBrowser } from './cdp.mjs';
const PORT = 3246;
const server = spawn(process.execPath, ['server.js', `--port=${PORT}`], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));
await withBrowser(async (p) => {
  await p.setViewport(390, 844, false);
  // ① 基因库页：筛猪鼻蛇
  await p.goto(`http://127.0.0.1:${PORT}/#/genes`, 1200);
  await p.eval(`(() => { const items=[...document.querySelectorAll('#f-species .seg-item')]; const it=items.find(x=>x.textContent.includes('猪鼻蛇')); if(it) it.click(); })()`, { awaitPromise: false });
  await new Promise((r) => setTimeout(r, 500));
  const geneRows = await p.eval(`(() => [...document.querySelectorAll('#gene-tbl tbody tr')].map(t=>[...t.children].map(c=>c.textContent.trim()).join(' | ')))()`);
  console.log('=== 基因库 · 猪鼻蛇 ===');
  geneRows.forEach(r => console.log('  ' + r));
  await p.shot('test/shots/gn-genelib.png', { width: 390, height: 844 });

  // ② 预测页：猪鼻蛇 白化康达 × 白化康达
  await p.goto(`http://127.0.0.1:${PORT}/#/predict`, 1200);
  await p.eval(`(() => { const s=document.getElementById('f-species'); const o=[...s.options].find(x=>x.textContent.includes('猪鼻蛇')); s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); })()`, { awaitPromise: false });
  await new Promise((r) => setTimeout(r, 500));
  async function pick(side, exact) {
    await p.eval(`(() => { const s=document.querySelector('#${side}-box .g-sel'); const o=[...s.options].find(x=>x.textContent.replace(/（.*$/,'')==='${exact}'); if(!o){window.__e=1;return;} s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); })()`, { awaitPromise: false });
    await new Promise((r) => setTimeout(r, 300));
  }
  await pick('male', '白化康达');
  await pick('female', '白化康达');
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await new Promise((r) => setTimeout(r, 700));
  const rows = await p.eval(`(() => { const m=[...document.querySelectorAll('.modal-mask')].pop(); return [...m.querySelectorAll('.gp-table tbody tr')].map(t=>[...t.children].map(c=>c.textContent.trim()).join(' | ')); })()`);
  console.log('\n=== 白化康达 × 白化康达 ===');
  rows.forEach(r => console.log('  ' + r));
  await p.shot('test/shots/gn-pred.png', { width: 390, height: 844 });

  // ③ 打开基因库详情：白化康达 是否含组分
  await p.eval(`(() => { [...document.querySelectorAll('.modal-mask')].forEach(x=>x.remove()); })()`, { awaitPromise: false });
  await new Promise((r) => setTimeout(r, 200));
  await p.goto(`http://127.0.0.1:${PORT}/#/genes`, 1200);
  await p.eval(`(() => { const items=[...document.querySelectorAll('#f-species .seg-item')]; const it=items.find(x=>x.textContent.includes('猪鼻蛇')); if(it) it.click(); })()`, { awaitPromise: false });
  await new Promise((r) => setTimeout(r, 400));
  const detail = await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const g = s.listGenes('sp-hognose').find(x=>x.name==='白化康达');
    return g ? { name:g.name, en:g.en, type:g.type, comboOf:g.comboOf, desc:g.desc } : null;
  })()`, { awaitPromise: true });
  console.log('\n白化康达 定义: ' + JSON.stringify(detail));
});
server.kill(); process.exit(0);
