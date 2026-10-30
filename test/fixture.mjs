// test/fixture.mjs —— 测试数据夹具（v2.3 起产品侧已删除「灌入测试数据」功能，
// 旧套件原依赖 rb-seed-test 开关在 boot 时灌入演示数据；现改为测试侧显式灌入）。
// 数据内容与已删除的 js/test-seed.js 一致：7 只个体（含已售/已赠送）、2 条配对、
// 1 枚蛋（含自动待办）、爬柜 + 2 爬箱、3 标签、自定义物种、4 条日志、额外账单，
// 全部名称带「[测试]」前缀。
export async function seedFixture(p) {
  return p.eval(`(async () => {
    const s = await import('./js/store.js');
    await s.initStore();
    if (s.S.animal.some((a) => (a.name || '').startsWith('[测试]'))) return { ok: true, skipped: true };
    const P = '[测试]';
    let spCustom = s.listSpecies().find((x) => x.name === P + '盖勾亚');
    if (!spCustom) spCustom = await s.createSpecies(P + '盖勾亚');
    const tagNames = [P + '苗子', P + '种公', P + '预定出'];
    const tagIds = [];
    for (const n of tagNames) {
      const t = s.listTags().find((x) => x.name === n) || (await s.createTag(n, '#c2543f'));
      tagIds.push(t.id);
    }
    const KEEPER = '测试铲屎官';
    const g1 = s.listGenes('sp-crested')[0];
    const g2 = s.listGenes('sp-crested')[1];
    const a1 = await s.createAnimal({ name: P + '守宫-公子', speciesId: 'sp-crested', sex: 'male', buyDate: '2026-08-01', buyPrice: 800, weight: 45, length: 20, geneIds: [g1 && g1.id].filter(Boolean), tagIds: [tagIds[1]], keeper: KEEPER, note: '测试数据：种公，状态稳定。' });
    const a2 = await s.createAnimal({ name: P + '守宫-母后', speciesId: 'sp-crested', sex: 'female', birthDate: '2025-06-15', weight: 40, length: 18, geneIds: [g1 && g1.id].filter(Boolean), tagIds: [], keeper: KEEPER, note: '测试数据：已产过一窝。' });
    const a3 = await s.createAnimal({ name: P + '守宫-公子2', speciesId: 'sp-crested', sex: 'male', buyDate: '2026-09-10', buyPrice: 650, weight: 30, geneIds: [g2 && g2.id].filter(Boolean), tagIds: [tagIds[0]], keeper: KEEPER });
    const h1 = await s.createAnimal({ name: P + '蛇-母', speciesId: 'sp-hognose', sex: 'female', buyDate: '2026-07-20', buyPrice: 1200, weight: 180, length: 45, geneIds: [], tagIds: [tagIds[2]], keeper: KEEPER });
    const gy1 = await s.createAnimal({ name: P + '勾亚-幼体', speciesId: spCustom.id, sex: 'unknown', birthDate: '2026-05-01', weight: 12, keeper: KEEPER });
    const s1 = await s.createAnimal({ name: P + '守宫-已售', speciesId: 'sp-crested', sex: 'male', buyDate: '2026-03-01', buyPrice: 500, keeper: KEEPER });
    await s.updateAnimal(s1.id, { status: 'sold', soldPrice: 1500, soldDate: '2026-10-05' });
    const g2a = await s.createAnimal({ name: P + '守宫-已赠送', speciesId: 'sp-crested', sex: 'female', buyDate: '2026-04-01', buyPrice: 600, keeper: KEEPER });
    await s.updateAnimal(g2a.id, { status: 'gift', soldDate: '2026-09-20' });
    await s.addLog(a1.id, 'feed', { food: '杜比亚蟑螂 3 只', amount: 3 });
    await s.addLog(a1.id, 'measure', { weight: 46, length: 20.5 });
    await s.addLog(a2.id, 'feed', { food: '钙粉+D3', amount: 1 });
    await s.addLog(h1.id, 'measure', { weight: 185, length: 46 });
    await s.createPairing({ participants: [a1.id, a2.id], pairDate: '2026-09-15', result: 'success', note: P + '交配成功，观察产蛋' });
    await s.createPairing({ participants: [a3.id, a2.id], pairDate: '2026-10-08', result: 'pending', note: P + '第二次合笼' });
    await s.createEgg({ motherId: a2.id, fatherId: a1.id, speciesId: 'sp-crested', status: 'fertile', layDate: '2026-10-02', temp: 23, expectHatchDate: '2026-11-16', note: P + '第一窝 2 枚' });
    const plan = await s.createPlan(P + '爬柜-客厅', { capacity: 4, lastCleanAt: '2026-10-01' });
    const cage1 = await s.createCage(plan.id, { sizeType: 'A4', zone: 'adult', color: '#3f8f6f', gridX: 0, gridY: 0 });
    const cage2 = await s.createCage(plan.id, { sizeType: 'R4', zone: 'nursery', color: '#c98f3f', gridX: 2, gridY: 0 });
    await s.updateAnimal(a1.id, { cageId: cage1.id });
    await s.updateAnimal(a2.id, { cageId: cage2.id });
    await s.createCustomTodo(P + '周末采购饲料与钙粉', '2026-10-25');
    await s.createBill({ type: 'expense', category: '饲料', amount: 268, relatedAnimalId: a1.id, date: '2026-10-10', note: P + '蟑螂+面包虫' });
    await s.createBill({ type: 'income', category: '售出个体', amount: 1500, relatedAnimalId: s1.id, date: '2026-10-05', note: P + '售出收款' });
    await s.reload();
    return { ok: true };
  })()`, { awaitPromise: true });
}
