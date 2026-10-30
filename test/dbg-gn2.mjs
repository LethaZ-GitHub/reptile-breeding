import { spawn } from 'node:child_process';
import { withBrowser } from './cdp.mjs';
const PORT = 3245;
const server = spawn(process.execPath, ['server.js', `--port=${PORT}`], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));
await withBrowser(async (p) => {
  await p.setViewport(390, 844, false);
  await p.goto(`http://127.0.0.1:${PORT}/#/predict`);
  await new Promise((r) => setTimeout(r, 1000));
  await p.eval(`(() => { const s=document.getElementById('f-species'); const o=[...s.options].find(x=>x.textContent.includes('猪鼻蛇')); s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await new Promise((r) => setTimeout(r, 600));

  // 精确按文本选中（不用 includes，避免匹配到「白化康达」）
  async function pick(side, exact) {
    await p.eval(`(() => {
      const s=document.querySelector('#${side}-box .g-sel');
      const o=[...s.options].find(x=>x.textContent.replace(/（.*$/,'')==='${exact}');
      if(!o) { window.__err='no option ${exact}'; return; }
      s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await new Promise((r) => setTimeout(r, 350));
  }
  await pick('male', '康达');
  await pick('female', '北极');
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await new Promise((r) => setTimeout(r, 700));
  const rows = await p.eval(`(() => { const m=[...document.querySelectorAll('.modal-mask')].pop(); return [...m.querySelectorAll('.gp-table tbody tr')].map(t=>[...t.children].map(c=>c.textContent.trim()).join(' | ')); })()`);
  console.log('康达 × 北极:');
  rows.forEach(r => console.log('   ' + r));
  await p.screenshot('test/shots/gn-kd-bj.png');

  // 库内是否有「康达+北极」这样的复合名
  const lib = await p.eval(`(async () => { const s = await import('./js/store.js'); return s.listGenes('sp-hognose').map(g=>g.name+'['+g.type+']'+(g.comboOf&&g.comboOf.length?'{'+g.comboOf.join('+')+'}':'')); })()`, { awaitPromise: true });
  console.log('\n猪鼻蛇基因库:');
  lib.forEach(x => console.log('   ' + x));

  // 再测白化康达 × 白化康达
  await p.eval(`(() => { [...document.querySelectorAll('.modal-mask')].forEach(x=>x.remove()); })()`);
  await new Promise((r) => setTimeout(r, 200));
  await pick('male', '白化康达');
  await pick('female', '白化康达');
  await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
  await new Promise((r) => setTimeout(r, 700));
  const rows2 = await p.eval(`(() => { const m=[...document.querySelectorAll('.modal-mask')].pop(); return [...m.querySelectorAll('.gp-table tbody tr')].map(t=>[...t.children].map(c=>c.textContent.trim()).join(' | ')); })()`);
  console.log('\n白化康达 × 白化康达:');
  rows2.forEach(r => console.log('   ' + r));
  await p.screenshot('test/shots/gn-bhd.png');
});
server.kill(); process.exit(0);
