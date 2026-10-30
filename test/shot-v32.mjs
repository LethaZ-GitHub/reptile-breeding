// v3.2 手动截图核验：喂食表单（只有选择框）+ 食物库搜索框样式 + 成长记录分页
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { withBrowser } from './cdp.mjs';

const PORT = 3239;
const OUT = 'test/shots';
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['server.js', `--port=${PORT}`], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));

await withBrowser(async (p) => {
  await p.setViewport(390, 844, false);
  await p.goto(`http://127.0.0.1:${PORT}/#/logs`);

  // 注入夹具：一只个体 + 食物库
  await p.eval(`(async () => {
    const s = await import('./js/store.js');
    const sp = (await import('./js/store.js')).listSpecies();
    const gecko = sp.find(x => x.name.includes('睫角')) || sp[0];
    const a = await s.createAnimal({ name: '截图甲', speciesId: gecko.id, sex: 'F' });
    window.__shotAnimal = a.id;
    return a.id;
  })()`, { awaitPromise: true });

  // 打开喂食记录弹窗
  await p.eval(`(async () => {
    const m = await import('./js/log-form.js');
    m.logFormModal({ animalId: window.__shotAnimal, type: 'feed', speciesId: null });
  })()`, { awaitPromise: true });
  await new Promise((r) => setTimeout(r, 900));
  await p.shot(`${OUT}/v32-feed-form.png`);

  // 关闭弹窗，打开食物库
  await p.eval(`(() => { document.querySelectorAll('.modal-mask').forEach(m => m.remove()); })()`);
  await p.eval(`(async () => {
    const f = await import('./js/foodlib.js');
    f.openFoodLibrary(() => {});
  })()`, { awaitPromise: true });
  await new Promise((r) => setTimeout(r, 900));
  await p.shot(`${OUT}/v32-foodlib.png`);
  console.log('screenshots done');
});

server.kill();
process.exit(0);
