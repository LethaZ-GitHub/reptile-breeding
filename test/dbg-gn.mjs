import { spawn } from 'node:child_process';
import { withBrowser } from './cdp.mjs';
const PORT = 3244;
const server = spawn(process.execPath, ['server.js', `--port=${PORT}`, '--no-open'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));
await withBrowser(async (p) => {
  await p.setViewport(390, 844, false);
  await p.goto(`http://127.0.0.1:${PORT}/#/predict`);
  await new Promise((r) => setTimeout(r, 1000));
  // 选猪鼻蛇
  await p.eval(`(() => { const s=document.getElementById('f-species'); const o=[...s.options].find(x=>x.textContent.includes('猪鼻蛇')); s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await new Promise((r) => setTimeout(r, 600));
  const opts = await p.eval(`(() => { const s=document.querySelector('#male-box .g-sel'); return [...s.options].map(o=>o.textContent); })()`);
  console.log('猪鼻蛇下拉选项(' + opts.length + '):', opts.join(' | '));

  async function run(m, f) {
    await p.eval(`(() => {
      const set=(side,val)=>{const s=document.querySelector('#'+side+'-box .g-sel'); const o=[...s.options].find(x=>x.textContent.includes(val)); s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true}));};
      set('male','${m}'); set('female','${f}');
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await p.eval(`document.getElementById('btn-run').click()`, { awaitPromise: false });
    await new Promise((r) => setTimeout(r, 700));
    const rows = await p.eval(`(() => { const m=[...document.querySelectorAll('.modal-mask')].pop(); const trs=m.querySelectorAll('.gp-table tbody tr'); return [...trs].map(t=>[...t.children].map(c=>c.textContent.trim()).join(' | ')); })()`);
    console.log(`\n== ${m} × ${f} ==`);
    rows.forEach(r=>console.log('   '+r));
    await p.eval(`(() => { const ms=[...document.querySelectorAll('.modal-mask')]; ms.forEach(x=>x.remove()); })()`);
    await new Promise((r) => setTimeout(r, 200));
  }
  await run('白化康达','白化康达');
  await run('太阳爆炸','太阳爆炸');
  await run('太阳爆炸','紫貂');
  await run('康达','北极');
  await run('粉红蜡笔白化','粉红蜡笔白化');
});
server.kill(); process.exit(0);
