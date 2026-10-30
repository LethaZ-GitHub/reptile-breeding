// test/shots.mjs —— 关键页面双端截图（桌面 1440×900 / 移动 390×844）
import { withBrowser } from './cdp.mjs';
import fs from 'node:fs';

const BASE = 'http://localhost:3210/';
const OUT = 'test/shots';
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['home', '#/home'],
  ['animals', '#/animals'],
  ['animal-detail', null],   // 动态取第一个个体
  ['eggs', '#/eggs'],
  ['cages', '#/cages'],
  ['cage-editor', null],     // 动态取第一个方案
  ['predict', '#/predict'],
  ['genes', '#/genes'],
  ['bills', '#/bills'],
  ['reports', '#/reports'],
  ['backup', '#/backup'],
  ['settings', '#/settings'],
];

await withBrowser(async (api) => {
  // 先导航到应用域（about:blank 上无法 import 应用模块）
  await api.goto(BASE + '#/home', 1200);
  // 造一批演示数据（当前会话的 IndexedDB）
  await api.eval(`(async () => {
    const s = await import('/js/store.js');
    await s.initStore();
    if (s.listAnimals().length) return 'seeded';
    const t1 = await s.createTag('高白', '#2e9e6b');
    const t2 = await s.createTag('待出手', '#e8912d');
    const a1 = await s.createAnimal({ name: '奶油', speciesId: 'sp-crested', sex: 'female', buyPrice: 680, birthDate: '2024-05-01', weight: 42.5, length: 32, geneIds: [s.listGenes('sp-crested')[0].id], tagIds: [t1.id], note: '性格温顺，高白表现稳定' });
    const a2 = await s.createAnimal({ name: '煤球', speciesId: 'sp-crested', sex: 'male', buyPrice: 520, weight: 38, length: 30, geneIds: [s.listGenes('sp-crested')[3].id], tagIds: [t2.id] });
    const a3 = await s.createAnimal({ name: '小雪', speciesId: 'sp-hognose', sex: 'female', buyPrice: 450, weight: 120, length: 45 });
    await s.addLog(a1.id, 'measure', { weight: 40, length: 30 });
    await s.addLog(a1.id, 'feed', { food: '果泥', qty: '5 g', ate: '吃完' });
    await s.addLog(a2.id, 'medical', { symptom: '蜕皮不畅', treatment: '加湿箱静养 3 天' });
    const p = await s.createPlan('主房爬柜');
    const c1 = await s.createCage(p.id, { sizeType: 'A4', color: '#3f8f6f', zone: 'adult', gridX: 1, gridY: 1, cleanMode: 'days', cleanDays: 30, lastCleanAt: new Date().toISOString().slice(0, 10) });
    const c2 = await s.createCage(p.id, { sizeType: 'A6', color: '#5b8fc9', zone: 'adult', gridX: 6, gridY: 2, cleanMode: 'days', cleanDays: 30 });
    const c3 = await s.createCage(p.id, { sizeType: 'R4', color: '#c95f6e', zone: 'nursery', gridX: 2, gridY: 5, cleanMode: 'calendar', cleanDayOfMonth: 1 });
    await s.bindAnimalToCage(a1.id, c1.id);
    await s.bindAnimalToCage(a2.id, c2.id);
    await s.createEgg({ motherId: a1.id, fatherId: a2.id, speciesId: 'sp-crested', status: 'fertile', layDate: '2026-09-20', expectHatchDate: '2026-11-08', note: '一窝第 1 颗' });
    await s.createEgg({ motherId: a1.id, fatherId: a2.id, speciesId: 'sp-crested', status: 'infertile', layDate: '2026-09-20', expectHatchDate: '2026-11-08' });
    await s.updateAnimal(a3.id, { status: 'sold', soldPrice: 900, soldDate: '2026-10-02' });
    await s.createBill({ type: 'expense', category: '饲料', amount: 128, date: '2026-10-03', note: '果泥 + 钙粉' });
    await s.createBill({ type: 'income', category: '售出个体', amount: 900, date: '2026-10-02', relatedAnimalId: a3.id, auto: true, countInStats: false, note: '小雪 售出' });
    await s.createCustomTodo('补充钙粉库存', '2026-10-19');
    return 'demo-seeded';
  })()`, { awaitPromise: true });

  for (const [name, hash] of PAGES) {
    let url = BASE + (hash || '#/home');
    if (name === 'animal-detail') {
      const id = await api.eval(`(async () => (await import('/js/store.js')).listAnimals()[0].id)()`, { awaitPromise: true });
      url = BASE + '#/animal/' + id;
    }
    if (name === 'cage-editor') {
      const id = await api.eval(`(async () => (await import('/js/store.js')).listPlans()[0].id)()`, { awaitPromise: true });
      url = BASE + '#/cage/' + id;
    }
    // 经过 about:blank 再进入，确保整页重新加载渲染（hash 相同不会触发重渲染）
    await api.goto('about:blank', 60);
    await api.goto(url, 1100);
    await api.shot(`${OUT}/desktop-${name}.png`, { width: 1440, height: 900 });
    await api.shot(`${OUT}/mobile-${name}.png`, { width: 390, height: 844 });
    console.log('shot:', name);
  }
  console.log('ALL SHOTS DONE');
}, { port: 9222 });
