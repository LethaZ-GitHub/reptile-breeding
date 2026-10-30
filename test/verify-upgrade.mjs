// test/verify-upgrade.mjs —— 验证 DB v1 → v3 升级不清用户数据
import { withBrowser } from './cdp.mjs';

const BASE = 'http://127.0.0.1:3123/';

await withBrowser(async (api) => {
  const R = [];
  const ok = (n, p, d = '') => { R.push([n, p]); console.log((p ? '✅' : '❌') + ' ' + n + (d ? ' — ' + d : '')); };

  // 1. 先在同源但不加载 app 的页面以 v1 旧结构建库并写入用户数据（模拟老版本 app 的库）
  //    注意：不能先加载 index.html，否则 app 会抢先把库建到 v3
  await api.goto(BASE + 'sw.js', 800);
  const seedV1 = await api.eval(`(async () => {
    const OLD = ['species', 'morph', 'gene', 'tag', 'animal', 'animal_photo', 'animal_log', 'egg', 'cage_plan', 'cage', 'todo', 'bill'];
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('reptile-breeding', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        OLD.forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['species', 'morph', 'animal', 'bill', 'meta'], 'readwrite');
    tx.objectStore('species').put({ id: 'sp-old', name: '老物种', isCustom: true });
    tx.objectStore('morph').put({ id: 'mp-old', speciesId: 'sp-old', name: '老品系', isCustom: true });
    tx.objectStore('animal').put({ id: 'an-old', name: '老个体', speciesId: 'sp-old', morphId: 'mp-old', sex: 'female', status: 'normal', tagIds: [], geneIds: [], createdAt: '2026-01-01 00:00:00' });
    tx.objectStore('bill').put({ id: 'bill-old', type: 'expense', category: '饲料', amount: 99, date: '2026-01-02' });
    tx.objectStore('meta').put(true, 'seeded');
    await new Promise((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
    return 'v1-seeded';
  })()`, { awaitPromise: true });
  ok('v1 旧库写入用户数据', seedV1 === 'v1-seeded', String(seedV1));

  // 2. 刷新页面 → app 以 v3 打开 → 触发 upgrade
  await api.goto(BASE + '#/animals', 3000);

  // 3. 验证：老数据保留 + pairing store 已建 + morph store 已删
  const check = await api.eval(`(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('reptile-breeding', 4); r.onsuccess = () => res(r.result); });
    const names = [...db.objectStoreNames];
    const read = (store) => new Promise((res) => {
      if (!names.includes(store)) return res('NO_STORE');
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result);
    });
    return JSON.stringify({
      version: db.version,
      names,
      species: await read('species'),
      animal: await read('animal'),
      bill: await read('bill'),
      pairing: await read('pairing'),
      morph: names.includes('morph') ? 'STILL_EXISTS' : 'REMOVED',
    });
  })()`, { awaitPromise: true });
  const c = JSON.parse(check);
  ok('库版本升级到 4', c.version === 4, 'v' + c.version);
  ok('老物种数据保留', c.species.some((s) => s.id === 'sp-old' && s.name === '老物种'));
  ok('老个体数据保留', c.animal.some((a) => a.id === 'an-old' && a.name === '老个体'));
  ok('老账单数据保留', c.bill.some((b) => b.id === 'bill-old'));
  ok('pairing 新表已创建', c.pairing === 'NO_STORE' ? false : Array.isArray(c.pairing));
  ok('food 食物库新表已创建', c.names.includes('food') ? true : false, JSON.stringify(c.names));
  ok('morph 品系表已移除', c.morph === 'REMOVED', String(c.morph));

  // 4. 页面正常渲染老个体
  const page = await api.eval(`(document.querySelector('#view')||{}).innerText || ''`);
  ok('个体列表页正常渲染老数据', page.includes('老个体'), page.slice(0, 60));

  const fail = R.filter((r) => !r[1]).length;
  console.log(`\n=== 升级兼容: ${R.length - fail}/${R.length} 通过 ===`);
  process.exit(fail ? 2 : 0);
});
