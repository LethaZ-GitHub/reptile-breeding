// store.js —— 业务数据访问层：内存缓存 + 写穿 IndexedDB
// 所有业务页面只依赖本模块，不直接碰 db.js。
'use strict';

import { openDB, dbPut, dbPutMany, dbDel, dbDelMany, dbAll, dbClear, getMeta, setMeta, atomicReplace, clearAllData } from './db.js';
import { seedRows, seedGene, seedFood, CAGE_SPECS, specGrid, TABLES, CLEAN_CYCLES, GENE_TYPES } from './schema.js';
import { rowsToSheet, sheetToRows } from './xlsx.js';
import { uuid, nowStr, nowIso, todayStr, dateStr, monthKey, addDays, daysBetween } from './util.js';
import { getSetting } from './settings.js';

// 单位换算统一从数据层出口（内部存储 g / cm，显示跟随全局设置）
export { dispWeight, dispLength, storeWeight, storeLength } from './settings.js';

/* ================= 缓存 ================= */
const S = {};
TABLES.forEach((t) => { S[t] = []; });
let ready = false;
export { S };

let initPromise = null; // 并发保护：避免多次调用导致 reload 竞态
export async function initStore() {
  if (ready) return;
  if (!initPromise) {
    initPromise = (async () => {
      await openDB();
      const seeded = await getMeta('seeded');
      if (!seeded) {
        const seeds = seedRows();
        for (const t of TABLES) await dbPutMany(t, seeds[t]);
        await setMeta('seeded', true);
      }
      await reload();
      ready = true;
      await ensureCodes(); // 老数据兜底：补个体/蛋唯一编号
      try {
        await syncBuiltinGenes(); // 内置基因库同步（新装机走 seed，老数据增量补/更新）
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[genes] 内置基因同步失败', e);
      }
      // 编号规范化：有基因但编号仍是物种前缀的个体，按基因英文缩写重发（一次性迁移）
      try {
        const normalized = await getMeta('codesNormalized');
        if (!normalized) {
          const n = await normalizeAnimalCodes();
          await setMeta('codesNormalized', true);
          if (n && typeof console !== 'undefined') console.info('[codes] 编号规范化', n, '条');
        }
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[codes] 规范化失败', e);
      }
      // 基因状态字段移除迁移（v2.6）：个体不再登记基因状态，统一按基因类型取默认值参与预测
      try {
        const gsRemoved = await getMeta('geneStatesRemoved');
        if (!gsRemoved) {
          const n = await stripGeneStates();
          await setMeta('geneStatesRemoved', true);
          if (n && typeof console !== 'undefined') console.info('[gene-state] 字段移除', n, '条');
        }
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[gene-state] 迁移失败', e);
      }
      // 待办字段规范化迁移（v2.7）：补齐 doneAt / cancelledAt，保证备份往返字段一致
      try {
        const tdNorm = await getMeta('todoFieldsNormalized');
        if (!tdNorm) {
          const n = await normalizeTodos();
          await setMeta('todoFieldsNormalized', true);
          if (n && typeof console !== 'undefined') console.info('[todo] 字段规范化', n, '条');
        }
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[todo] 字段规范化失败', e);
      }
      // 食物库内置项补齐（v3.1）：老用户升级后首次启动写入内置三条食物
      try {
        const fNorm = await getMeta('foodsSeeded');
        if (!fNorm) {
          const n = await ensureBuiltinFoods();
          await setMeta('foodsSeeded', true);
          if (n && typeof console !== 'undefined') console.info('[food] 内置食物补齐', n, '条');
        }
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[food] 内置食物补齐失败', e);
      }
    })();
    return initPromise;
  }
  return initPromise;
}
export async function reload() {
  for (const t of TABLES) S[t] = await dbAll(t);
}

/* ---------- 测试数据清理（v2.3 起「灌入测试数据」功能已整体删除，
   仅保留对历史版本可能残留的「[测试]」前缀记录的清理入口） ---------- */
const TEST_PREFIX = '[测试]';
export async function clearTestData() {
  const isTest = (a) => !!(a && typeof a.name === 'string' && a.name.startsWith(TEST_PREFIX));
  const hasTestAnimal = (id) => S.animal.some((a) => a.id === id && isTest(a));
  const removed = { animal: 0, pairing: 0, egg: 0, bill: 0, tag: 0, plan: 0, species: 0 };
  // 1. 账单（关联个体或备注带前缀）
  for (const b of [...S.bill]) {
    if ((b.note || '').includes(TEST_PREFIX) || (b.relatedAnimalId && hasTestAnimal(b.relatedAnimalId))) {
      await removeBill(b.id); removed.bill++;
    }
  }
  // 2. 配对（参与者含测试个体）
  for (const p of [...S.pairing]) {
    if (p.participants.some((id) => hasTestAnimal(id))) { await removePairing(p.id); removed.pairing++; }
  }
  // 3. 蛋（母本/父本为测试个体）
  for (const e of [...S.egg]) {
    if (hasTestAnimal(e.motherId) || hasTestAnimal(e.fatherId)) { await removeEgg(e.id); removed.egg++; }
  }
  // 4. 个体（级联清日志/照片/待办）
  for (const a of [...S.animal]) {
    if (isTest(a)) { await removeAnimal(a.id); removed.animal++; }
  }
  // 5. 标签
  for (const t of [...S.tag]) {
    if (isTest(t)) { await removeTag(t.id); removed.tag++; }
  }
  // 6. 爬柜方案（含爬箱）
  for (const p of [...S.cage_plan]) {
    if (isTest(p)) {
      const cages = S.cage.filter((c) => c.planId === p.id).map((c) => c.id);
      if (cages.length) await dbDelMany('cage', cages);
      await dbDel('cage_plan', p.id);
      removed.plan++;
    }
  }
  // 7. 自定义测试物种（此时已无个体引用）
  for (const s of [...S.species]) {
    if (isTest(s)) { await removeSpecies(s.id); removed.species++; }
  }
  // 8. 兜底：自定义待办等标题带前缀的残留记录、悬空日志
  for (const row of await dbAll('todo')) {
    if ((row.title || '').includes(TEST_PREFIX)) await dbDel('todo', row.id);
  }
  for (const row of await dbAll('animal_log')) {
    if (row.animalId && !S.animal.some((a) => a.id === row.animalId)) await dbDel('animal_log', row.id);
  }
  await reload();
  return { ok: true, removed };
}

/* ================= 通用查询 ================= */
const byId = (t, id) => S[t].find((r) => r.id === id) || null;
const nameOf = (t, id) => { const r = byId(t, id); return r ? r.name : ''; };
export const speciesName = (id) => nameOf('species', id);
export const geneName = (id) => nameOf('gene', id);
export const tagById = (id) => byId('tag', id);
export const animalName = (id) => nameOf('animal', id);

export const STATUS = {
  normal: { label: '正常', cls: 'st-ok' },
  sold: { label: '已售出', cls: 'st-sold' },
  dead: { label: '已离世', cls: 'st-dead' },
  gift: { label: '已赠送', cls: 'st-gift' },
};
export const EGG_STATUS = {
  fertile: { label: '受精', cls: 'fertile' },
  infertile: { label: '无精', cls: 'infertile' },
  moldy: { label: '发霉', cls: 'moldy' },
  addled: { label: '瘪蛋', cls: 'addled' },
  hatched: { label: '已孵化', cls: 'hatched' },
  dead: { label: '报废', cls: 'dead' },
};
export const LOG_TYPES = {
  feed: { label: '喂食', icon: '🍽️' },
  medical: { label: '医疗', icon: '💉' },
  measure: { label: '体重体长', icon: '⚖️' },
};
export const CAGE_ZONES = { nursery: '育苗箱', adult: '成体箱' };

/* ================= 物种 ================= */
export const listSpecies = () => [...S.species].sort((a, b) => (a.isCustom ? 1 : 0) - (b.isCustom ? 1 : 0));
export async function createSpecies(name) {
  name = (name || '').trim();
  if (!name) throw new Error('物种名称不能为空');
  if (S.species.some((s) => s.name === name)) throw new Error('物种已存在');
  const row = { id: uuid(), name, isCustom: true, createdAt: nowIso() };
  await dbPut('species', row); S.species.push(row);
  return row;
}
// 修改物种：仅允许修改自定义物种（v3.1：内置物种不可修改）
export async function updateSpecies(id, patch) {
  const s = byId('species', id);
  if (!s) throw new Error('物种不存在');
  if (!s.isCustom) throw new Error('内置物种不可修改');
  const name = (patch.name || '').trim();
  if (!name) throw new Error('物种名称不能为空');
  if (S.species.some((x) => x.id !== id && x.name === name)) throw new Error('物种已存在');
  s.name = name;
  await dbPut('species', s);
  return s;
}
// 删除物种：内置物种禁止删除；被个体使用的自定义物种禁止删除
export async function removeSpecies(id) {
  const s = byId('species', id);
  if (!s) return;
  if (!s.isCustom) throw new Error('内置物种不可删除');
  const used = S.animal.filter((a) => a.speciesId === id).length;
  if (used > 0) throw new Error(`该自定义物种正被 ${used} 只个体使用，禁止删除`);
  await dbDel('species', id); S.species = S.species.filter((r) => r.id !== id);
}

/* ================= 食物库（v3.1） =================
   food 行：{ id, name, speciesIds: [], isCustom, createdAt }
   speciesIds 为空 = 通用食物（所有物种都显示）；非空 = 仅所选物种显示。 */
export const listFoods = () => [...S.food].sort((a, b) =>
  (a.isCustom ? 1 : 0) - (b.isCustom ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
export const getFood = (id) => byId('food', id);
// 某物种可见的食物：通用食物 + 归属该物种的食物
export const foodsForSpecies = (speciesId) => listFoods()
  .filter((f) => !f.speciesId || !f.speciesId.length || (speciesId && f.speciesId.includes(speciesId)));
export async function createFood({ name, speciesId = [], speciesIds = null }) {
  name = (name || '').trim();
  if (!name) throw new Error('食物名称不能为空');
  if (S.food.some((f) => f.name === name)) throw new Error('该食物已存在');
  const raw = Array.isArray(speciesIds) ? speciesIds : (Array.isArray(speciesId) ? speciesId : []);
  const ids = raw.filter((id) => S.species.some((s) => s.id === id));
  const row = { id: uuid(), name, speciesId: ids, isCustom: true, createdAt: nowIso() };
  await dbPut('food', row); S.food.push(row);
  return row;
}
export async function updateFood(id, patch) {
  const f = byId('food', id);
  if (!f) throw new Error('食物不存在');
  const name = (patch.name || f.name || '').trim();
  if (!name) throw new Error('食物名称不能为空');
  if (S.food.some((x) => x.id !== id && x.name === name)) throw new Error('该食物已存在');
  f.name = name;
  const raw = Array.isArray(patch.speciesIds) ? patch.speciesIds
    : (Array.isArray(patch.speciesId) ? patch.speciesId : null);
  if (raw) f.speciesId = raw.filter((sid) => S.species.some((s) => s.id === sid));
  await dbPut('food', f);
  return f;
}
export async function removeFood(id) {
  const f = byId('food', id);
  if (!f) return;
  await dbDel('food', id);
  S.food = S.food.filter((r) => r.id !== id);
}
// 内置食物一次性补齐（老用户升级后首次启动写入内置三条；此后不再强制恢复，
// 用户删除内置食物不会被自动塞回）
export async function ensureBuiltinFoods() {
  let added = 0;
  for (const f of seedFood()) {
    if (!byId('food', f.id)) {
      const row = { ...f, createdAt: nowIso() };
      await dbPut('food', row); S.food.push(row); added += 1;
    }
  }
  return added;
}

/* ================= 基因库 ================= */
export const listGenes = (speciesId) => S.gene.filter((g) => !speciesId || g.speciesId === speciesId);
export async function createGene({ speciesId, name, en, type, desc, comboOf }) {
  name = (name || '').trim();
  if (!name) throw new Error('基因名称不能为空');
  // v2.0 起多基因选育已取消：仅允许 GENE_TYPES 内的遗传类型
  if (!GENE_TYPES[type]) throw new Error('不支持的基因遗传类型');
  // v3.5：杂合（het）基因由隐性基因自动派生，不允许手动创建
  if (type === 'het') throw new Error('杂合基因由隐性基因自动生成，无需单独创建');
  if (S.gene.some((g) => g.speciesId === speciesId && g.name === name)) throw new Error('该物种下基因已存在');
  const row = { id: uuid(), speciesId, name, en: (en || '').trim(), type, desc: desc || '', comboOf: Array.isArray(comboOf) ? comboOf.filter(Boolean) : [], isCustom: true, hetOf: '', createdAt: nowIso() };
  await dbPut('gene', row); S.gene.push(row);
  // v3.5：隐性基因自动派生一条杂合（het）基因（名称 =「隐」+ 原名）
  if (type === 'recessive') await deriveHetGene(row);
  return row;
}
// v3.5：杂合（het）基因派生
//   名称 =「隐」+ 隐性基因名；hetOf 指向对应隐性基因 id；
//   het 与该隐性基因共享同一位点，预测时按 h 态（单份携带）参与孟德尔计算。
export function hetGeneName(baseName) {
  return '隐' + baseName;
}
// v3.5：判断某行是否为「自动派生的杂合基因」（由隐性基因自动生成，不可直接编辑/删除）
export function isDerivedHet(g) {
  if (!g || g.type !== 'het') return false;
  if (g.hetOf) return S.gene.some((x) => x.id === g.hetOf && x.type === 'recessive');
  const base = String(g.name || '').replace(/^隐/, '');
  return S.gene.some((x) => x.type === 'recessive' && x.name === base);
}
// 依据隐性基因行派生（或更新）对应的 het 行
export async function deriveHetGene(base) {
  if (!base || base.type !== 'recessive') return null;
  const wantName = hetGeneName(base.name);
  let het = S.gene.find((g) => g.type === 'het' && g.hetOf === base.id);
  if (!het) {
    // 也可能存在旧数据里按名称匹配的 het 行（无 hetOf）
    het = S.gene.find((g) => g.type === 'het' && g.speciesId === base.speciesId && g.name === wantName) || null;
  }
  const desc = `杂合基因：「${base.name}」的单份携带（杂合）状态，本身不表现，可传给后代。`;
  if (het) {
    const changed = het.name !== wantName || het.hetOf !== base.id || het.desc !== desc || het.en !== (base.en ? base.en + ' Het' : '');
    if (changed) {
      het.name = wantName;
      het.hetOf = base.id;
      het.desc = desc;
      het.en = base.en ? base.en + ' Het' : '';
      await dbPut('gene', het);
    }
    return het;
  }
  const row = {
    id: uuid(), speciesId: base.speciesId, name: wantName,
    en: base.en ? base.en + ' Het' : '', type: 'het', desc,
    comboOf: [], isCustom: base.isCustom === true, hetOf: base.id, createdAt: nowIso(),
  };
  await dbPut('gene', row); S.gene.push(row);
  return row;
}
// 修改基因：仅允许修改自定义基因（v2.5：内置基因不允许修改，「恢复出厂」可一键还原内置数据）
export async function updateGene(id, patch) {
  const g = byId('gene', id);
  if (!g) throw new Error('基因不存在');
  if (!g.isCustom) throw new Error('内置基因不可修改，仅自定义基因可编辑');
  // v3.5：自动派生的杂合基因不可直接编辑（请编辑其对应的隐性基因）
  if (isDerivedHet(g)) throw new Error('杂合基因由对应的隐性基因自动生成，请编辑该隐性基因');
  const wasType = g.type;
  const wasName = g.name;
  Object.assign(g, patch);
  if (patch.name !== undefined) g.name = String(patch.name).trim();
  if (patch.comboOf !== undefined) g.comboOf = Array.isArray(patch.comboOf) ? patch.comboOf.filter(Boolean) : [];
  await dbPut('gene', g);
  // v3.5：隐性 ↔ 杂合的联动维护
  //   改名 → 同步 het 行名称；改为隐性 → 补派生 het；改为非隐性 → 移除对应 het 行。
  if (wasType === 'recessive' && g.type !== 'recessive') {
    await removeHetFor(g.id);
  } else if (g.type === 'recessive') {
    if (wasName !== g.name) await deriveHetGene(g);
    else await deriveHetGene(g);
  }
}
// v3.5：移除某隐性基因对应的 het 行（连带解除个体引用）
export async function removeHetFor(baseId) {
  const hets = S.gene.filter((x) => x.type === 'het' && (x.hetOf === baseId
    || S.gene.some((b) => b.id === baseId && b.name === x.name.slice(1))));
  for (const h of hets) {
    for (const a of S.animal) {
      if ((a.geneIds || []).includes(h.id)) {
        a.geneIds = (a.geneIds || []).filter((x) => x !== h.id);
        a.updatedAt = nowIso();
        await dbPut('animal', a);
      }
    }
    await dbDel('gene', h.id);
    S.gene = S.gene.filter((r) => r.id !== h.id);
  }
  return hets.length;
}
// 删除基因（硬删除）：仅允许删除自定义基因（v2.5：内置基因不允许删除）；
// 同步从所有个体的基因列表中移除引用
export async function removeGene(id) {
  const g = byId('gene', id);
  if (!g) return 0;
  if (!g.isCustom) throw new Error('内置基因不可删除，仅自定义基因可删除');
  // v3.5：自动派生的杂合基因不可单独删除
  if (isDerivedHet(g)) throw new Error('杂合基因由对应的隐性基因自动生成，请删除该隐性基因');
  // v3.5：删除隐性基因时一并移除其派生的 het 行
  if (g.type === 'recessive') await removeHetFor(id);
  let n = 0;
  for (const a of S.animal) {
    if ((a.geneIds || []).includes(id)) {
      a.geneIds = (a.geneIds || []).filter((x) => x !== id);
      a.updatedAt = nowIso();
      await dbPut('animal', a);
      n += 1;
    }
  }
  await dbDel('gene', id);
  S.gene = S.gene.filter((r) => r.id !== id);
  return n;
}
export const geneUsedCount = (id) => S.animal.filter((a) => (a.geneIds || []).includes(id)).length;
export const geneInvalidCount = () => S.gene.filter((g) => g.isInvalid).length;

/* ---- 基因库恢复出厂 / 导入导出 ---- */
// 仅重置基因库：清空基因表并重新写入内置种子，其他业务数据不受影响
export async function resetGenes() {
  await dbClear('gene');
  const seeds = seedRows().gene;
  await dbPutMany('gene', seeds);
  await reload();
  return seeds.length;
}
// 导出基因库为 JSON 包（含内置 + 自定义）
export function exportGenes() {
  return {
    app: 'reptile-breeding-genes',
    format: 1,
    exportedAt: nowIso(),
    counts: { gene: S.gene.length },
    genes: JSON.parse(JSON.stringify(S.gene)),
  };
}
export function validateGenePkg(pkg) {
  if (!pkg || pkg.app !== 'reptile-breeding-genes' || pkg.format !== 1) throw new Error('不是有效的基因库备份包');
  if (!Array.isArray(pkg.genes)) throw new Error('备份包缺少基因数据');
  return true;
}
// 导入基因库：mode='merge' 按 id 覆盖合并；mode='replace' 清空后全量写入
export async function importGenes(pkg, mode = 'merge') {
  validateGenePkg(pkg);
  const rows = pkg.genes.filter((g) => g && g.id && g.name);
  if (mode === 'replace') {
    await dbClear('gene');
    await dbPutMany('gene', rows);
  } else {
    await dbPutMany('gene', rows);
  }
  await reload();
  return rows.length;
}

/* ================= 标签 ================= */
export const listTags = () => [...S.tag];
export async function createTag(name, color) {
  name = (name || '').trim();
  if (!name) throw new Error('标签名称不能为空');
  if (S.tag.some((t) => t.name === name)) throw new Error('标签已存在');
  const row = { id: uuid(), name, color: color || '#2e9e6b' };
  await dbPut('tag', row); S.tag.push(row);
  return row;
}
export async function updateTag(id, patch) {
  const t = byId('tag', id);
  if (!t) return;
  Object.assign(t, patch);
  await dbPut('tag', t);
}
// 删除在用标签：允许，但同步从所有个体上移除
export async function removeTag(id) {
  const t = byId('tag', id);
  if (!t) return;
  const users = S.animal.filter((a) => (a.tagIds || []).includes(id));
  for (const a of users) {
    a.tagIds = (a.tagIds || []).filter((x) => x !== id);
    a.updatedAt = nowIso();
    await dbPut('animal', a);
  }
  await dbDel('tag', id); S.tag = S.tag.filter((r) => r.id !== id);
  return users.length;
}
export const tagChipHtml = (tagId) => {
  const t = byId('tag', tagId);
  if (!t) return '';
  return `<span class="tag-chip" style="background:${t.color}">${escapeHtml(t.name)}</span>`;
};

/* ================= 个体 ================= */
export const listAnimals = (opts = {}) => {
  const { q = '', speciesId = '', sex = '', status = 'all', tagId = '' } = opts;
  const kw = q.trim().toLowerCase();
  return S.animal.filter((a) => {
    if (speciesId && a.speciesId !== speciesId) return false;
    if (sex && a.sex !== sex) return false;
    if (tagId && !(a.tagIds || []).includes(tagId)) return false;
    if (status === 'archived' && !a.isArchived) return false;
    if (status === 'active' && a.isArchived) return false;
    if (status !== 'all' && status !== 'archived' && status !== 'active' && a.status !== status) return false;
    if (kw && !(a.name || '').toLowerCase().includes(kw)) return false;
    return true;
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
};
export const getAnimal = (id) => byId('animal', id);
export const allAnimals = () => [...S.animal];

/* ================= 唯一编号 =================
   个体编号：<基因缩写>-<3位序号>；未选择基因时缩写为 N（含蛇等所有物种）；
   蛋编号：<母本基因缩写>×<父本基因缩写>-<3位序号>（无父本 / 无基因记 N）。
   序号按各自前缀顺序递增，不重复；编号创建后固定，编辑基因时按新基因重新编号。 */
export function geneAbbr(gene) {
  if (!gene) return '';
  if (gene.en) {
    const parts = String(gene.en).split(/[\s·\-_]+/).filter(Boolean);
    if (parts.length >= 2) return parts.map((p) => p[0].toUpperCase()).join('');
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase(); // 单词取前两位（Albino → AL）
  }
  return (gene.name || '').slice(0, 2).toUpperCase();
}
function speciesAbbr(speciesId) {
  const sp = byId('species', speciesId);
  return (sp && sp.name) ? sp.name.slice(0, 2) : 'XX';
}
function animalGeneAbbr(animal) {
  if (!animal) return '';
  const g = (animal.geneIds || []).length ? byId('gene', animal.geneIds[0]) : null;
  return g ? (geneAbbr(g) || 'N') : 'N'; // 无基因统一记 N
}
function nextSeq(table, prefix) {
  let max = 0;
  for (const r of S[table]) {
    const c = r.code || '';
    if (c.startsWith(prefix)) {
      const n = parseInt(c.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}
export function nextAnimalCode(speciesId, geneIds) {
  const gene = (geneIds || []).length ? byId('gene', geneIds[0]) : null;
  const abbr = gene ? (geneAbbr(gene) || 'N') : 'N'; // 无基因 → N
  const prefix = abbr + '-';
  return prefix + String(nextSeq('animal', prefix)).padStart(3, '0');
}
export function nextEggCode(motherId, fatherId) {
  const mAbbr = animalGeneAbbr(byId('animal', motherId)) || 'XX';
  const f = fatherId ? byId('animal', fatherId) : null;
  const fAbbr = f ? (animalGeneAbbr(f) || 'NA') : 'NA';
  const prefix = `${mAbbr}×${fAbbr}-`;
  return prefix + String(nextSeq('egg', prefix)).padStart(3, '0');
}
// 老数据兜底：为缺编号的个体 / 蛋补发（启动时执行一次）
export async function ensureCodes() {
  for (const a of S.animal) {
    if (!a.code) { a.code = nextAnimalCode(a.speciesId, a.geneIds); await dbPut('animal', a); }
  }
  for (const e of S.egg) {
    if (!e.code) { e.code = nextEggCode(e.motherId, e.fatherId); await dbPut('egg', e); }
  }
}
// 内置基因同步（启动时幂等执行）：把 schema 中的内置基因增量写入已有数据库。
//   ① 种子清单内的：新增 / 更新（名称、类型、描述、复合组分等以种子为准）；
//   ② 已不在种子清单的内置基因（isCustom=false）：自动删除——
//      如 v1.8 下线的多基因选育内置项（淡纹/高对比/奶油/褪纹/超红）；
//      仍被个体 geneIds 引用的保留不删（避免引用悬空），仅告警，用户可在基因库页自行处理。
export async function syncBuiltinGenes() {
  let added = 0, updated = 0, removed = 0;
  const seed = seedGene();
  const comboOfSame = (a, b) => {
    const x = Array.isArray(a) ? a.join('|') : '';
    const y = Array.isArray(b) ? b.join('|') : '';
    return x === y;
  };
  // v3.5：把存量内置行重建成与种子完全一致的键集与键序
  //   —— 删除 v3.4 遗留的 allowHet 键，新增 hetOf 键（v3.5 杂合关联）。
  //   Excel 备份表头取「所有行键的并集」，若存量行残留 allowHet，
  //   往返后其余行会被补上 allowHet: ""，导致备份包 JSON 比对不一致。
  const rebuildKeys = (cur, g) => {
    const next = {};
    for (const k of Object.keys(g)) next[k] = (k in cur) ? cur[k] : g[k];
    next.createdAt = cur.createdAt || nowIso();
    for (const k of Object.keys(cur)) delete cur[k];
    Object.assign(cur, next);
  };
  for (const g of seed) {
    const cur = byId('gene', g.id);
    if (!cur) {
      const row = { ...g, createdAt: nowIso() };
      await dbPut('gene', row); S.gene.push(row); added++;
    } else if (!cur.isCustom && (cur.name !== g.name || cur.en !== g.en || cur.type !== g.type || cur.desc !== g.desc || !comboOfSame(cur.comboOf, g.comboOf) || (cur.hetOf || '') !== (g.hetOf || '') || 'allowHet' in cur || !('hetOf' in cur))) {
      // v3.5：同步名称/类型/描述/组分/hetOf，并按种子顺序重建键序（清除 allowHet 残留）
      Object.assign(cur, { name: g.name, en: g.en, type: g.type, desc: g.desc, comboOf: g.comboOf || [], hetOf: g.hetOf || '' });
      rebuildKeys(cur, g);
      await dbPut('gene', cur); updated++;
    }
  }
  const seedIds = new Set(seed.map((g) => g.id));
  for (const g of [...S.gene]) {
    if (g.isCustom || seedIds.has(g.id)) continue;
    const used = S.animal.some((a) => (a.geneIds || []).includes(g.id));
    if (used) {
      if (typeof console !== 'undefined') console.warn('[genes] 内置基因已下线但仍被个体引用，暂保留：', g.name);
      continue;
    }
    await dbDel('gene', g.id);
    S.gene = S.gene.filter((r) => r.id !== g.id);
    removed++;
  }
  return { added, updated, removed };
}
// 编号规范化（一次性迁移）：旧版「物种前缀」编号统一迁移——
//   ① 有基因 → 基因英文缩写（如 猪鼻-001 → AL-001）；
//   ② 无基因 → N 前缀（如 睫角-001 → N-001，蛇同样规则）。
export async function normalizeAnimalCodes() {
  let n = 0;
  for (const a of S.animal) {
    const g = (a.geneIds || []).length ? byId('gene', a.geneIds[0]) : null;
    const want = g ? (geneAbbr(g) || 'N') : 'N';
    const curPrefix = (a.code || '').replace(/-\d+$/, '');
    const spAbbr = speciesAbbr(a.speciesId);
    if (curPrefix && curPrefix === spAbbr && curPrefix !== want) {
      a.code = nextAnimalCode(a.speciesId, a.geneIds);
      await dbPut('animal', a);
      n += 1;
    }
  }
  return n;
}
// 基因状态字段移除（v2.6）：新建/编辑个体不再登记基因状态（预测统一按基因类型取默认值），
// 一次性迁移把存量个体上的 geneState 字段删掉
export async function stripGeneStates() {
  let n = 0;
  for (const a of S.animal) {
    if ('geneState' in a) { delete a.geneState; await dbPut('animal', a); n += 1; }
  }
  return n;
}

// v2.7：待办字段规范化——补齐 doneAt / cancelledAt 键。
// 背景：createTodo 早期不写这两个字段，而 importTodos 会补上，
// 导致 Excel 备份往返后待办对象键集变化（多出 cancelledAt），字段一致性断言失败。
export async function normalizeTodos() {
  let n = 0;
  for (const t of S.todo) {
    let changed = false;
    if (!('doneAt' in t)) { t.doneAt = ''; changed = true; }
    if (!('cancelledAt' in t)) { t.cancelledAt = ''; changed = true; }
    if (changed) { await dbPut('todo', t); n += 1; }
  }
  return n;
}

export async function createAnimal(data) {
  const row = {
    id: uuid(), name: (data.name || '').trim() || '未命名',
    code: data.code || nextAnimalCode(data.speciesId, data.geneIds),
    speciesId: data.speciesId || '',
    sex: data.sex || 'unknown',
    tagIds: data.tagIds || [],
    keeper: data.keeper == null ? (getSetting('keeperName') || '') : String(data.keeper).trim(),
    buyDate: data.buyDate || '', buyPrice: data.buyPrice == null || data.buyPrice === '' ? null : Number(data.buyPrice),
    birthDate: data.birthDate || '', note: data.note || '',
    status: data.status || 'normal', soldPrice: null, soldCountInStats: true, soldDate: '',
    weight: data.weight == null || data.weight === '' ? null : Number(data.weight),
    length: data.length == null || data.length === '' ? null : Number(data.length),
    geneIds: data.geneIds || [],
    phenotype: data.phenotype == null ? '' : String(data.phenotype).trim(), // 表现（手动输入，可空）
    cageId: data.cageId || null,
    motherId: data.motherId || null, fatherId: data.fatherId || null,
    fromEggId: data.fromEggId || null, // 来源蛋（孵化登记时回写双向关联）
    isArchived: false, archivedAt: '', archiveReason: '',
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  if (row.status !== 'normal') { row.isArchived = true; row.archivedAt = nowStr(); }
  await dbPut('animal', row); S.animal.push(row);
  syncBuyBill(row);
  return row;
}

export async function updateAnimal(id, patch) {
  const a = byId('animal', id);
  if (!a) throw new Error('个体不存在');
  const oldStatus = a.status;
  const oldGeneId = (a.geneIds || [])[0] || null;
  Object.assign(a, patch);
  a.updatedAt = nowIso();
  // 基因变化（含改为无基因）：按新基因英文缩写重新编号，序号取当前该前缀最大号 +1
  if (patch.geneIds) {
    const newGeneId = (a.geneIds || [])[0] || null;
    if (newGeneId !== oldGeneId) {
      a.code = nextAnimalCode(a.speciesId, a.geneIds);
    }
  }
  // v2.6：基因状态字段已废止——编辑时一律剥掉（含旧备份导入带入的残留）
  delete a.geneState;
  if (patch.status && patch.status !== oldStatus) {
    if (a.status !== 'normal') {
      // 状态变为 已售出/已离世/已赠送 → 自动进入归档列表
      a.isArchived = true; a.archivedAt = nowStr(); a.archiveReason = a.status;
    } else {
      a.isArchived = false; a.archivedAt = ''; a.archiveReason = '';
    }
  }
  await dbPut('animal', a);
  await syncBuyBill(a);
  await syncSoldBill(a, oldStatus);
  return a;
}

export async function cloneAnimal(id) {
  const a = byId('animal', id);
  if (!a) throw new Error('个体不存在');
  const row = {
    ...a,
    id: uuid(),
    code: nextAnimalCode(a.speciesId, a.geneIds),
    name: a.name + '（克隆）',
    tagIds: [...(a.tagIds || [])],
    geneIds: [...(a.geneIds || [])],
    status: 'normal', soldPrice: null, soldCountInStats: true, soldDate: '',
    isArchived: false, archivedAt: '', archiveReason: '',
    cageId: null, motherId: null, fatherId: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  await dbPut('animal', row); S.animal.push(row);
  return row;
}

// 删除个体：级联清除照片 / 日志 / 蛋记录 / 配对记录 / 关联待办；账单保留但解除关联
export async function removeAnimal(id) {
  const a = byId('animal', id);
  if (!a) return;
  const photoIds = S.animal_photo.filter((p) => p.animalId === id).map((p) => p.id);
  if (photoIds.length) await dbDelMany('animal_photo', photoIds);
  const logIds = S.animal_log.filter((l) => l.animalId === id).map((l) => l.id);
  if (logIds.length) await dbDelMany('animal_log', logIds);
  const eggIds = S.egg.filter((e) => e.motherId === id || e.fatherId === id).map((e) => e.id);
  if (eggIds.length) await dbDelMany('egg', eggIds);
  // 解除「蛋 → 该个体」的孵化关联（非父母本角色的蛋记录本身保留）
  for (const e of S.egg) {
    if (e.hatchedAnimalId === id && !eggIds.includes(e.id)) { e.hatchedAnimalId = null; await dbPut('egg', e); }
  }
  const pairingIds = S.pairing.filter((p) => (p.participants || []).includes(id)).map((p) => p.id);
  if (pairingIds.length) await dbDelMany('pairing', pairingIds);
  const todoIds = S.todo.filter((t) => eggIds.includes(t.sourceId)
    || (t.sourceType === 'animal' && t.sourceId === id)
    || (t.sourceType === 'pairing-check' && pairingIds.includes(t.sourceId))).map((t) => t.id);
  if (todoIds.length) await dbDelMany('todo', todoIds);
  for (const b of S.bill) {
    if (b.relatedAnimalId === id) { b.relatedAnimalId = null; await dbPut('bill', b); }
  }
  await dbDel('animal', id);
  S.animal_photo = S.animal_photo.filter((r) => !photoIds.includes(r.id));
  S.animal_log = S.animal_log.filter((r) => !logIds.includes(r.id));
  S.egg = S.egg.filter((r) => !eggIds.includes(r.id));
  S.pairing = S.pairing.filter((r) => !pairingIds.includes(r.id));
  S.todo = S.todo.filter((r) => !todoIds.includes(r.id));
  S.animal = S.animal.filter((r) => r.id !== id);
}

export async function setAnimalArchived(id, archived) {
  const a = byId('animal', id);
  if (!a) return;
  a.isArchived = !!archived;
  a.archivedAt = archived ? nowStr() : '';
  a.archiveReason = archived ? 'manual' : '';
  await dbPut('animal', a);
}

export const eggCountOfMother = (animalId) => S.egg.filter((e) => e.motherId === animalId).length;

/* ---- 谱系 ---- */
export function pedigreeOf(id) {
  const a = byId('animal', id);
  if (!a) return null;
  const parents = [a.motherId, a.fatherId].filter(Boolean).map((pid) => byId('animal', pid)).filter(Boolean);
  const grandparents = [];
  parents.forEach((p) => {
    [p.motherId, p.fatherId].filter(Boolean).forEach((gid) => {
      const g = byId('animal', gid);
      if (g) grandparents.push(g);
    });
  });
  const children = S.animal.filter((x) => x.motherId === id || x.fatherId === id);
  return { self: a, parents, grandparents, children };
}

/* ---- 照片 ---- */
export const listPhotos = (animalId) => S.animal_photo.filter((p) => p.animalId === animalId);
export async function addPhoto(animalId, { full, thumb }) {
  const cnt = listPhotos(animalId).length;
  if (cnt >= 3) throw new Error('单只个体最多上传 3 张照片');
  const row = { id: uuid(), animalId, full, thumb, isThumbnail: cnt === 0, createdAt: nowIso() };
  await dbPut('animal_photo', row); S.animal_photo.push(row);
  return row;
}
export async function removePhoto(id) {
  await dbDel('animal_photo', id);
  S.animal_photo = S.animal_photo.filter((r) => r.id !== id);
}
export async function setThumbnail(animalId, photoId) {
  for (const p of S.animal_photo.filter((x) => x.animalId === animalId)) {
    p.isThumbnail = p.id === photoId;
    await dbPut('animal_photo', p);
  }
}
export function thumbOf(animal) {
  if (!animal) return null;
  const photos = listPhotos(animal.id);
  return photos.find((p) => p.isThumbnail) || photos[0] || null;
}

/* ---- 日志 ---- */
export async function addLog(animalId, logType, data, createTime = '') {
  const row = {
    id: uuid(), animalId, logType, data: data || {},
    createTime: createTime || nowStr(), // 默认当前时间；createTime 传值仅用于成长历史补录
  };
  await dbPut('animal_log', row); S.animal_log.push(row);
  if (logType === 'measure' && (data.weight != null || data.length != null)) {
    const a = byId('animal', animalId);
    if (a) {
      if (data.weight != null && data.weight !== '') a.weight = Number(data.weight);
      if (data.length != null && data.length !== '') a.length = Number(data.length);
      a.updatedAt = nowIso();
      await dbPut('animal', a);
    }
  }
  return row;
}
export async function updateLog(id, patch) {
  const l = byId('animal_log', id);
  if (!l) return;
  if (patch.data) l.data = { ...l.data, ...patch.data };
  if (patch.createTime) l.createTime = patch.createTime;
  await dbPut('animal_log', l);
  // v3.1：修改测量记录时同步个体当前体重 / 体长（与 addLog 保持一致）
  if (l.logType === 'measure' && patch.data) {
    const a = byId('animal', l.animalId);
    if (a) {
      let changed = false;
      if (patch.data.weight != null && patch.data.weight !== '') { a.weight = Number(patch.data.weight); changed = true; }
      if (patch.data.length != null && patch.data.length !== '') { a.length = Number(patch.data.length); changed = true; }
      if (changed) { a.updatedAt = nowIso(); await dbPut('animal', a); }
    }
  }
  return l;
}
export async function removeLog(id) {
  await dbDel('animal_log', id);
  S.animal_log = S.animal_log.filter((r) => r.id !== id);
}
export const listLogs = (animalId, logType) =>
  S.animal_log.filter((l) => l.animalId === animalId && (!logType || l.logType === logType))
    .sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
export const measureLogs = (animalId) =>
  listLogs(animalId, 'measure').slice().reverse(); // 时间正序，用于趋势图

/* ================= 配对记录 ================= */
// 一次配对可涉及多方（通常一公一母）；participants 存放全部参与个体的 id
export const listPairings = (animalId) => (animalId
  ? S.pairing.filter((p) => (p.participants || []).includes(animalId))
  : [...S.pairing])
  .sort((a, b) => (b.pairDate || '').localeCompare(a.pairDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
export const getPairing = (id) => byId('pairing', id);
export async function createPairing(data) {
  const participants = (data.participants || []).filter(Boolean);
  if (participants.length < 2) throw new Error('配对至少需要选择两个个体');
  if (new Set(participants).size !== participants.length) throw new Error('同一个个体不能重复选择');
  const row = {
    id: uuid(),
    participants,
    pairDate: data.pairDate || todayStr(),
    note: (data.note || '').trim(),
    result: data.result || 'pending', // pending | success | failed
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  await dbPut('pairing', row); S.pairing.push(row);
  // 自动待办：产卵检查（配对日期 + 20 天）——仅母本生成，父本不需要
  await syncPairingCheckTodos(row, [], participants);
  return row;
}
// 配对产卵待办同步：只为母本参与者各生成一条（dedupeKey=pairing-check:配对id:母本id）
async function syncPairingCheckTodos(pairing, oldParticipants, newParticipants) {
  const femaleIds = (ids) => ids.filter((id) => { const a = byId('animal', id); return a && a.sex === 'female'; });
  const oldSet = new Set(femaleIds(oldParticipants || []));
  const newFemales = femaleIds(newParticipants || []);
  const due = addDays(pairing.pairDate, 20);
  // 新增母本 → 建待办
  for (const fid of newFemales) {
    if (oldSet.has(fid)) continue;
    await createTodo({
      sourceType: 'pairing-check', sourceId: pairing.id, dedupeKey: `pairing-check:${pairing.id}:${fid}`,
      title: `产卵检查：${animalName(fid) || '母本'}`,
      deadline: due,
    });
  }
  // 移除的母本 → 删除其待办
  const removed = [...oldSet].filter((id) => !newFemales.includes(id));
  if (removed.length) {
    const ids = S.todo.filter((t) => removed.some((fid) => t.dedupeKey === `pairing-check:${pairing.id}:${fid}`)).map((t) => t.id);
    if (ids.length) await dbDelMany('todo', ids);
    S.todo = S.todo.filter((t) => !ids.includes(t.id));
  }
  // 配对日期变化 → 同步全部（含已取消的复活为 pending）
  const list = S.todo.filter((t) => t.sourceType === 'pairing-check' && t.sourceId === pairing.id);
  for (const t of list) {
    if (t.deadline !== due || t.status !== 'pending') {
      t.deadline = due; t.status = 'pending'; t.cancelledAt = ''; t.doneAt = '';
      await dbPut('todo', t);
    }
  }
}
export async function updatePairing(id, patch) {
  const p = byId('pairing', id);
  if (!p) return;
  const participants = (patch.participants || p.participants || []).filter(Boolean);
  if (participants.length < 2) throw new Error('配对至少需要选择两个个体');
  const oldParticipants = [...(p.participants || [])];
  Object.assign(p, patch, { participants, updatedAt: nowIso() });
  await dbPut('pairing', p);
  // 配对日期 / 参与者变化 → 同步产卵检查待办（截止日期、母本增减）
  await syncPairingCheckTodos(p, oldParticipants, participants);
  return p;
}
export async function removePairing(id) {
  await dbDel('pairing', id);
  S.pairing = S.pairing.filter((r) => r.id !== id);
  // 级联删除该配对自动生成的产卵检查待办
  const ids = S.todo.filter((t) => t.sourceType === 'pairing-check' && t.sourceId === id).map((t) => t.id);
  if (ids.length) await dbDelMany('todo', ids);
  S.todo = S.todo.filter((t) => !ids.includes(t.id));
}
export const PAIR_RESULTS = {
  pending: { label: '待观察', cls: 'st-unknown' },
  success: { label: '配对成功', cls: 'st-ok' },
  failed: { label: '未成功', cls: 'st-dead' },
};

/* ================= 蛋 ================= */
export const listEggs = (opts = {}) => {
  const { archived = false, motherId = '' } = opts;
  return S.egg.filter((e) => (e.isArchived ? 1 : 0) === (archived ? 1 : 0) && (!motherId || e.motherId === motherId))
    .sort((a, b) => (b.layDate || '').localeCompare(a.layDate || ''));
};
export const getEgg = (id) => byId('egg', id);

/* ---- 蛋 ↔ 个体 双向关联 ---- */
// 关联：蛋记录孵化出的个体（一只蛋最多关联一只个体；一个个体的来源蛋唯一）
export async function linkEggAnimal(eggId, animalId) {
  const e = byId('egg', eggId);
  const a = byId('animal', animalId);
  if (!e || !a) throw new Error('蛋或个体不存在');
  // 一个个体的来源蛋唯一：若已关联其他蛋，先解除旧关联
  if (a.fromEggId && a.fromEggId !== eggId) {
    const old = byId('egg', a.fromEggId);
    if (old && old.hatchedAnimalId === animalId) { old.hatchedAnimalId = null; await dbPut('egg', old); }
  }
  // 一颗蛋若已关联其他个体，先解除
  if (e.hatchedAnimalId && e.hatchedAnimalId !== animalId) {
    const oldA = byId('animal', e.hatchedAnimalId);
    if (oldA && oldA.fromEggId === eggId) { oldA.fromEggId = null; oldA.updatedAt = nowIso(); await dbPut('animal', oldA); }
  }
  e.hatchedAnimalId = animalId;
  a.fromEggId = eggId; a.updatedAt = nowIso();
  await dbPut('egg', e); await dbPut('animal', a);
}
// 解除关联
export async function unlinkEggAnimal(eggId) {
  const e = byId('egg', eggId);
  if (!e || !e.hatchedAnimalId) return;
  const a = byId('animal', e.hatchedAnimalId);
  if (a && a.fromEggId === eggId) { a.fromEggId = null; a.updatedAt = nowIso(); await dbPut('animal', a); }
  e.hatchedAnimalId = null;
  await dbPut('egg', e);
}
// 某颗蛋是否「已孵化但未关联个体」（归档列表提示 + 手动关联入口）
export const eggUnlinked = (e) => e && (e.status === 'hatched' || (e.isArchived && e.archiveReason === 'hatched')) && !e.hatchedAnimalId;
// 关联个体的编号 + 基因（蛋详情展示用）
export function linkedAnimalBrief(egg) {
  const a = egg && egg.hatchedAnimalId ? byId('animal', egg.hatchedAnimalId) : null;
  if (!a) return null;
  const genes = (a.geneIds || []).map((gid) => { const g = byId('gene', gid); return g ? g.name : ''; }).filter(Boolean);
  const stateTxt = animalGeneStateText(a);
  return { animal: a, geneText: genes.join('、') || '无基因', geneStateText: stateTxt };
}
// 个体基因文案（如「莉莉白」；无基因返回空。v2.6 起基因状态字段已废止）
export function animalGeneStateText(a) {
  if (!a || !(a.geneIds || []).length) return '';
  const g = byId('gene', a.geneIds[0]);
  return g ? g.name : '';
}
// 同窝个体：① 同父同母的同胞；② 与来源蛋同母本、同产蛋日期批次中其他蛋孵出的个体
export function clutchAnimals(id) {
  const a = byId('animal', id);
  if (!a) return [];
  const out = new Map();
  const sameParents = (x) => a.motherId && x.motherId === a.motherId && a.fatherId && x.fatherId === a.fatherId;
  S.animal.forEach((x) => { if (x.id !== id && sameParents(x)) out.set(x.id, x); });
  if (a.fromEggId) {
    const e0 = byId('egg', a.fromEggId);
    if (e0 && e0.motherId) {
      S.egg.filter((e) => e.motherId === e0.motherId && e.layDate === e0.layDate && e.hatchedAnimalId && e.hatchedAnimalId !== id)
        .forEach((e) => { const x = byId('animal', e.hatchedAnimalId); if (x) out.set(x.id, x); });
    }
  }
  return [...out.values()].sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || ''));
}

export async function createEgg(data) {
  const row = {
    id: uuid(),
    code: nextEggCode(data.motherId, data.fatherId),
    motherId: data.motherId || null, fatherId: data.fatherId || null,
    speciesId: data.speciesId || '',
    status: data.status || 'fertile',
    layDate: data.layDate || todayStr(),
    temp: data.temp == null || data.temp === '' ? null : Number(data.temp),
    expectHatchDate: data.expectHatchDate || '',
    note: data.note || '',
    hatchedAnimalId: null, // 孵化后关联的个体（双向：animal.fromEggId）
    isArchived: false, archivedAt: '', archiveReason: '',
    createdAt: nowIso(),
  };
  await dbPut('egg', row); S.egg.push(row);
  // 自动待办：破壳提醒（受精 + 有预计破壳日）
  // v2.1 起产卵检查待办只由配对记录生成（仅母本），建蛋不再生成挂个体的产后检查待办
  if (row.status === 'fertile' && row.expectHatchDate) {
    await createTodo({
      sourceType: 'egg-hatch', sourceId: row.id,
      title: `破壳提醒：${animalName(row.motherId) || '母本'}的蛋`,
      deadline: row.expectHatchDate,
    });
  }
  return row;
}

export async function updateEgg(id, patch) {
  const e = byId('egg', id);
  if (!e) return;
  const oldStatus = e.status;
  const oldHatch = e.expectHatchDate;
  Object.assign(e, patch);
  await dbPut('egg', e);
  // 破壳待办联动
  await syncHatchTodo(e, oldStatus, oldHatch);
  return e;
}

async function syncHatchTodo(e, oldStatus, oldHatch) {
  const need = e.status === 'fertile' && e.expectHatchDate && !e.isArchived;
  const todo = S.todo.find((t) => t.sourceType === 'egg-hatch' && t.sourceId === e.id);
  if (need) {
    if (!todo) {
      await createTodo({ sourceType: 'egg-hatch', sourceId: e.id, title: `破壳提醒：${animalName(e.motherId) || '母本'}的蛋`, deadline: e.expectHatchDate });
    } else if (todo.deadline !== e.expectHatchDate || todo.status !== 'pending') {
      todo.deadline = e.expectHatchDate; todo.status = 'pending';
      await dbPut('todo', todo);
    }
  } else if (todo) {
    // 标记归档 / 报废 / 改状态 → 自动取消破壳待办
    if (todo.status === 'pending') {
      todo.status = 'cancelled'; todo.cancelledAt = nowStr();
      await dbPut('todo', todo);
    }
  }
}

export async function archiveEgg(id, reason = 'manual') {
  const e = byId('egg', id);
  if (!e) return;
  e.isArchived = true; e.archivedAt = nowStr(); e.archiveReason = reason;
  await dbPut('egg', e);
  await syncHatchTodo(e, '', '');
  // 同母本同批次的蛋全部归档后，取消挂起的产后检查待办
  const sameBatchLeft = S.egg.filter((x) => x.motherId === e.motherId && x.layDate === e.layDate && !x.isArchived).length;
  if (!sameBatchLeft) {
    const due = addDays(e.layDate, 10);
    const lc = S.todo.find((t) => t.sourceType === 'laying-check' && t.sourceId === e.motherId && t.deadline === due && t.status === 'pending');
    if (lc) { lc.status = 'cancelled'; lc.cancelledAt = nowStr(); await dbPut('todo', lc); }
  }
}
export async function unarchiveEgg(id) {
  const e = byId('egg', id);
  if (!e) return;
  e.isArchived = false; e.archivedAt = ''; e.archiveReason = '';
  await dbPut('egg', e);
  await syncHatchTodo(e, '', '');
}
export async function removeEgg(id) {
  const e0 = byId('egg', id);
  // 解除「个体 → 该蛋」的来源关联（个体记录本身保留）
  if (e0 && e0.hatchedAnimalId) {
    const a = byId('animal', e0.hatchedAnimalId);
    if (a && a.fromEggId === id) { a.fromEggId = null; a.updatedAt = nowIso(); await dbPut('animal', a); }
  }
  await dbDel('egg', id);
  S.egg = S.egg.filter((r) => r.id !== id);
  const ids = S.todo.filter((t) => t.sourceId === id).map((t) => t.id);
  if (ids.length) await dbDelMany('todo', ids);
  S.todo = S.todo.filter((t) => !ids.includes(t.id));
}

/* ================= 爬柜 / 爬箱 ================= */
export const listPlans = () => [...S.cage_plan].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
export const getPlan = (id) => byId('cage_plan', id);
export async function createPlan(name, opts = {}) {
  name = (name || '').trim() || '新爬柜方案';
  const row = {
    id: uuid(), name,
    capacity: Math.min(60, Math.max(1, +opts.capacity || 4)),   // 可放爬箱数
    lastCleanAt: opts.lastCleanAt || todayStr(),                // 方案级上次清理时间
    cleanCycle: CLEAN_CYCLES[opts.cleanCycle] ? opts.cleanCycle : 'month', // 周/月/季/半年
    createdAt: nowIso(),
  };
  await dbPut('cage_plan', row); S.cage_plan.push(row);
  return row;
}
export async function updatePlan(id, patch) {
  const p = byId('cage_plan', id);
  if (!p) return;
  if (patch.capacity != null) patch.capacity = Math.min(60, Math.max(1, +patch.capacity || 4));
  if (patch.cleanCycle != null && !CLEAN_CYCLES[patch.cleanCycle]) delete patch.cleanCycle;
  Object.assign(p, patch);
  await dbPut('cage_plan', p);
  return p;
}
export async function renamePlan(id, name) {
  const p = byId('cage_plan', id);
  if (!p) return;
  p.name = (name || '').trim() || p.name;
  await dbPut('cage_plan', p);
}
export async function removePlan(id) {
  const cages = S.cage.filter((c) => c.planId === id);
  const cageIds = cages.map((c) => c.id);
  // 解绑箱内个体 & 取消清理待办
  for (const a of S.animal) {
    if (cageIds.includes(a.cageId)) { a.cageId = null; await dbPut('animal', a); }
  }
  const todoIds = S.todo.filter((t) => cageIds.includes(t.sourceId)).map((t) => t.id);
  if (todoIds.length) await dbDelMany('todo', todoIds);
  if (cageIds.length) await dbDelMany('cage', cageIds);
  await dbDel('cage_plan', id);
  S.cage = S.cage.filter((c) => c.planId !== id);
  S.todo = S.todo.filter((t) => !todoIds.includes(t.id));
  S.cage_plan = S.cage_plan.filter((r) => r.id !== id);
}

export const listCages = (planId) => S.cage.filter((c) => c.planId === planId);
export const getCage = (id) => byId('cage', id);
export async function createCage(planId, data) {
  const grid = specGrid(data.sizeType);
  const row = {
    id: uuid(), planId,
    sizeType: data.sizeType || 'A4',
    color: data.color || '#3f8f6f',
    gridX: data.gridX ?? 0, gridY: data.gridY ?? 0,
    gridW: grid.w, gridH: grid.h,
    zone: data.zone || 'adult',
    cleanMode: data.cleanMode || 'days',       // days | calendar
    cleanDays: data.cleanDays ?? 30,
    cleanDayOfMonth: data.cleanDayOfMonth ?? 1,
    lastCleanAt: data.lastCleanAt || todayStr(),
    note: data.note || '',
    createdAt: nowIso(),
  };
  await dbPut('cage', row); S.cage.push(row);
  return row;
}
export async function updateCage(id, patch) {
  const c = byId('cage', id);
  if (!c) return;
  Object.assign(c, patch);
  await dbPut('cage', c);
}
export async function removeCage(id) {
  const c = byId('cage', id);
  if (!c) return;
  for (const a of S.animal) {
    if (a.cageId === id) { a.cageId = null; await dbPut('animal', a); }
  }
  const todoIds = S.todo.filter((t) => t.sourceType === 'cage-clean' && t.sourceId === id).map((t) => t.id);
  if (todoIds.length) await dbDelMany('todo', todoIds);
  await dbDel('cage', id);
  S.cage = S.cage.filter((r) => r.id !== id);
  S.todo = S.todo.filter((t) => !todoIds.includes(t.id));
}

export const animalsInCage = (cageId) => S.animal.filter((a) => a.cageId === cageId);
export async function bindAnimalToCage(animalId, cageId) {
  const a = byId('animal', animalId);
  if (!a) return;
  a.cageId = cageId || null;   // 一个个体只能绑定一个爬箱
  a.updatedAt = nowIso();
  await dbPut('animal', a);
}

// 清理周期：跟随所属方案的清理周期（周/月/季/半年），基准取方案级「上次清理时间」
export function cleanDueOf(cage) {
  const plan = byId('cage_plan', cage.planId);
  const cycle = (plan && plan.cleanCycle && CLEAN_CYCLES[plan.cleanCycle]) || null;
  const days = cycle ? cycle.days : (+cage.cleanDays || 30);
  const base = (plan && plan.lastCleanAt) || cage.lastCleanAt || (cage.createdAt || '').slice(0, 10) || todayStr();
  const due = addDays(base, days);
  const left = daysBetween(todayStr(), due);
  return { due, left, days };
}
// 箱内最近记录（按个体日志合并取最新 3 条）
export function recentLogsOfCage(cageId, limit = 3) {
  const ids = animalsInCage(cageId).map((a) => a.id);
  return S.animal_log.filter((l) => ids.includes(l.animalId))
    .sort((a, b) => (b.createTime || '').localeCompare(a.createTime || '')).slice(0, limit);
}

/* ================= 待办 ================= */
export const getTodo = (id) => byId('todo', id);
export const listTodos = (status = 'pending') =>
  S.todo.filter((t) => !status || t.status === status)
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));
export const pendingTodoCount = () => S.todo.filter((t) => t.status === 'pending').length;
export async function createTodo({ sourceType, sourceId = '', title, deadline, dedupeKey = '' }) {
  const dup = S.todo.find((t) => t.status === 'pending' && t.sourceType === sourceType
    && (dedupeKey ? t.dedupeKey === dedupeKey : (t.sourceId === sourceId && t.deadline === deadline)));
  if (dup) return dup;
  const row = {
    id: uuid(), sourceType, sourceId, dedupeKey: dedupeKey || '', title: title || '待办',
    deadline, status: 'pending', doneAt: '', cancelledAt: '', createdAt: nowIso(),
  };
  await dbPut('todo', row); S.todo.push(row);
  return row;
}
export async function createCustomTodo(title, deadline, sourceId = '') {
  if (!title || !deadline) throw new Error('标题和截止日期必填');
  return createTodo({ sourceType: 'custom', sourceId, title, deadline });
}
export async function completeTodo(id) {
  const t = byId('todo', id);
  if (!t) return;
  t.status = 'done'; t.doneAt = nowStr();
  await dbPut('todo', t);
}
export async function cancelTodo(id) {
  const t = byId('todo', id);
  if (!t) return;
  t.status = 'cancelled'; t.cancelledAt = nowStr();
  await dbPut('todo', t);
}
export async function delayTodo(id, newDeadline) {
  const t = byId('todo', id);
  if (!t) return;
  t.deadline = newDeadline;   // 手动延期：修改截止日期
  await dbPut('todo', t);
}
// 工单管理：改标题 / 截止日期 / 状态
export async function updateTodo(id, patch) {
  const t = byId('todo', id);
  if (!t) return;
  if (patch.title != null) t.title = String(patch.title).trim() || t.title;
  if (patch.deadline != null) t.deadline = patch.deadline;
  if (patch.status != null && ['pending', 'done', 'cancelled'].includes(patch.status)) {
    t.status = patch.status;
    if (patch.status === 'done' && !t.doneAt) t.doneAt = nowStr();
    if (patch.status === 'cancelled' && !t.cancelledAt) t.cancelledAt = nowStr();
    if (patch.status === 'pending') { t.doneAt = ''; t.cancelledAt = ''; }
  }
  await dbPut('todo', t);
  return t;
}
// 已完成 → 重新打开为待办
export async function reopenTodo(id) {
  const t = byId('todo', id);
  if (!t) return;
  t.status = 'pending'; t.doneAt = ''; t.cancelledAt = '';
  await dbPut('todo', t);
}
// 硬删除工单
export async function removeTodo(id) {
  await dbDel('todo', id);
  S.todo = S.todo.filter((r) => r.id !== id);
}
// 全部工单（按截止日期倒序，新近的在前）
export const listAllTodos = () =>
  [...S.todo].sort((a, b) => (b.deadline || '').localeCompare(a.deadline || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
// 工单导出（JSON 包，供工单管理页导入合并）
export function exportTodos(rows) {
  return {
    app: 'reptile-breeding-todos',
    format: 1,
    exportedAt: nowIso(),
    counts: { todo: rows.length },
    todos: JSON.parse(JSON.stringify(rows)),
  };
}
export function validateTodoPkg(pkg) {
  if (!pkg || pkg.app !== 'reptile-breeding-todos' || pkg.format !== 1) throw new Error('不是有效的工单备份包');
  if (!Array.isArray(pkg.todos)) throw new Error('备份包缺少工单数据');
  return true;
}
// 工单导入：按 ID 覆盖合并（不动其他表）
export async function importTodos(pkg) {
  validateTodoPkg(pkg);
  const rows = pkg.todos.filter((t) => t && t.id && t.title);
  let added = 0, updated = 0;
  for (const r of rows) {
    const exists = byId('todo', r.id);
    const row = {
      id: r.id, sourceType: r.sourceType || 'custom', sourceId: r.sourceId || '',
      title: r.title, deadline: r.deadline || '',
      status: ['pending', 'done', 'cancelled'].includes(r.status) ? r.status : 'pending',
      doneAt: r.doneAt || '', cancelledAt: r.cancelledAt || '',
      createdAt: r.createdAt || nowIso(),
    };
    await dbPut('todo', row);
    if (exists) updated += 1; else { S.todo.push(row); added += 1; }
  }
  await reload();
  return { added, updated };
}

// 同步单个爬箱的清理待办：周期 / 上次清理时间变更后截止日会变——
// 有待办（含已取消的）：更新截止日/标题并恢复 pending；无待办且进入 7 天窗口：新建
async function syncCageCleanTodo(c, due, left) {
  const list = S.todo.filter((t) => t.sourceType === 'cage-clean' && t.sourceId === c.id);
  const title = `爬箱清理：${CAGE_SPECS[c.sizeType]?.label || c.sizeType} · ${animalsInCage(c.id).map((a) => a.name).join('、') || '空箱'}`;
  if (left <= 7) {
    const keep = list.find((t) => t.status === 'pending') || list.find((t) => t.status === 'cancelled') || null;
    if (keep) {
      const dupes = list.filter((t) => t !== keep && t.status === 'pending');
      if (keep.deadline !== due || keep.status !== 'pending' || keep.title !== title) {
        keep.deadline = due; keep.status = 'pending'; keep.title = title; keep.cancelledAt = '';
        await dbPut('todo', keep);
      }
      for (const t of dupes) { t.status = 'cancelled'; t.cancelledAt = nowStr(); await dbPut('todo', t); }
    } else {
      await createTodo({ sourceType: 'cage-clean', sourceId: c.id, title, deadline: due });
    }
  } else {
    for (const t of list.filter((t) => t.status === 'pending')) {
      t.status = 'cancelled'; t.cancelledAt = nowStr(); await dbPut('todo', t);
    }
  }
}

// 自动待办补齐：爬箱清理（到期前 7 天可见）+ 蛋破壳提醒
export async function refreshAutoTodos() {
  for (const c of S.cage) {
    const { due, left } = cleanDueOf(c);
    await syncCageCleanTodo(c, due, left);
  }
  for (const e of S.egg) {
    if (e.status === 'fertile' && e.expectHatchDate && !e.isArchived) {
      await createTodo({
        sourceType: 'egg-hatch', sourceId: e.id,
        title: `破壳提醒：${animalName(e.motherId) || '母本'}的蛋`,
        deadline: e.expectHatchDate,
      });
    }
  }
}

/* ================= 记账 ================= */
export const BILL_CATS = {
  expense: ['购宠', '饲料', '用品设备', '医疗', '温控器材', '其他支出'],
  income: ['售出个体', '其他收入'],
};
export const listBills = (opts = {}) => {
  const { month = '', type = '' } = opts;
  return S.bill.filter((b) => (!month || (b.date || '').startsWith(month)) && (!type || b.type === type))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
};
export async function createBill(data) {
  const row = {
    id: uuid(), type: data.type || 'expense',
    category: data.category || '其他支出',
    amount: Number(data.amount) || 0,
    relatedAnimalId: data.relatedAnimalId || null,
    date: data.date || todayStr(),
    note: data.note || '',
    countInStats: data.countInStats !== false,
    auto: !!data.auto,
    createdAt: nowIso(),
  };
  await dbPut('bill', row); S.bill.push(row);
  return row;
}
export async function updateBill(id, patch) {
  const b = byId('bill', id);
  if (!b) return;
  Object.assign(b, patch);
  await dbPut('bill', b);
}
export async function removeBill(id) {
  await dbDel('bill', id);
  S.bill = S.bill.filter((r) => r.id !== id);
}
// 个体购入价格 → 自动支出
function syncBuyBill(a) {
  const existing = S.bill.find((b) => b.auto && b.relatedAnimalId === a.id && b.type === 'expense');
  if (a.buyPrice != null && a.buyPrice !== '') {
    const amount = Number(a.buyPrice);
    if (existing) { existing.amount = amount; existing.date = a.buyDate || existing.date; return dbPut('bill', existing); }
    return createBill({ type: 'expense', category: '购宠', amount, relatedAnimalId: a.id, date: a.buyDate || todayStr(), auto: true, note: `${a.name} 购入` });
  } else if (existing) {
    return removeBill(existing.id);
  }
}
// 个体售出金额 → 自动收入（是否纳入统计跟随全局开关）
function syncSoldBill(a, oldStatus) {
  const existing = S.bill.find((b) => b.auto && b.relatedAnimalId === a.id && b.type === 'income');
  const nowSold = a.status === 'sold';
  if (nowSold && a.soldPrice != null && a.soldPrice !== '') {
    const amount = Number(a.soldPrice);
    if (existing) { existing.amount = amount; return dbPut('bill', existing); }
    return createBill({ type: 'income', category: '售出个体', amount, relatedAnimalId: a.id, date: a.soldDate || todayStr(), auto: true, countInStats: getSetting('countSoldIncome'), note: `${a.name} 售出` });
  } else if (existing && (!nowSold || a.soldPrice == null || a.soldPrice === '')) {
    return removeBill(existing.id);
  }
}
// 全局开关变化时同步所有售出收入账单
export async function syncSoldIncomeFlag(on) {
  for (const b of S.bill) {
    if (b.auto && b.type === 'income' && b.category === '售出个体' && b.countInStats !== on) {
      b.countInStats = on;
      await dbPut('bill', b);
    }
  }
}

// 月度报表
export function reportOf(month) {
  const expense = {}, income = {};
  let expTotal = 0, incTotal = 0, incSold = 0, incOther = 0;
  for (const b of S.bill) {
    if (!(b.date || '').startsWith(month)) continue;
    if (b.type === 'expense') {
      expense[b.category] = (expense[b.category] || 0) + b.amount;
      expTotal += b.amount;
    } else {
      const counted = b.countInStats !== false;
      if (!counted) continue;
      income[b.category] = (income[b.category] || 0) + b.amount;
      incTotal += b.amount;
      if (b.category === '售出个体') incSold += b.amount; else incOther += b.amount;
    }
  }
  return { expense, income, expTotal, incTotal, incSold, incOther, net: incTotal - expTotal };
}
export const billCountOfMonth = (month) => S.bill.filter((b) => (b.date || '').startsWith(month)).length;

/* ================= 备份 / 分享 ================= */
// opts.tables：传入表名数组 → 部分备份（包内仅含所选表，partial: true）；缺省 → 全量备份
export function buildBackup(opts = {}) {
  const only = Array.isArray(opts.tables) && opts.tables.length
    ? opts.tables.filter((t) => TABLES.includes(t))
    : null;
  const picked = only || TABLES;
  const tables = {};
  picked.forEach((t) => { tables[t] = JSON.parse(JSON.stringify(S[t])); });
  return {
    app: 'reptile-breeding',
    format: 1,
    partial: !!only,
    exportedAt: nowIso(),
    device: navigator.userAgent.includes('Android') ? 'app-android' : (navigator.userAgent.includes('iPhone') ? 'app-ios' : 'web'),
    counts: picked.reduce((o, t) => { o[t] = tables[t].length; return o; }, {}),
    tables,
  };
}
// 校验备份包结构（部分包只要求至少含一张已知表）
export function validateBackup(pkg) {
  if (!pkg || pkg.app !== 'reptile-breeding' || pkg.format !== 1) throw new Error('不是有效的养个爬备份包');
  if (!pkg.tables || typeof pkg.tables !== 'object') throw new Error('备份包缺少数据表');
  if (pkg.partial) {
    const any = TABLES.some((t) => Array.isArray(pkg.tables[t]));
    if (!any) throw new Error('部分备份包未包含任何数据表');
  } else {
    for (const t of ['animal', 'species']) {
      if (!Array.isArray(pkg.tables[t])) throw new Error(`备份包缺少 ${t} 表`);
    }
  }
  return true;
}
// 本机数据最近修改时间（用于导入前时间戳比对）
export function localLatestTime() {
  let latest = '';
  ['animal', 'animal_photo', 'animal_log', 'egg', 'pairing', 'cage', 'bill', 'todo', 'food'].forEach((t) => {
    S[t].forEach((r) => {
      const ts = r.updatedAt || r.createTime || r.createdAt || '';
      if (ts > latest) latest = ts;
    });
  });
  return latest;
}
// 导入：全量包 → 单事务原子替换；部分包 → 按 ID 覆盖合并（不清空其他表）
export async function importBackup(pkg) {
  validateBackup(pkg);
  // v2.6：基因状态字段已废止——导入时剥掉旧备份个体行上的 geneState 残留
  const cleanAnimals = (rows) => (Array.isArray(rows) ? rows : []).map((r) => {
    if (r && 'geneState' in r) { const { geneState, ...rest } = r; return rest; }
    return r;
  });
  if (pkg.partial) {
    let n = 0;
    for (const t of TABLES) {
      let rows = Array.isArray(pkg.tables[t]) ? pkg.tables[t].filter((r) => r && r.id) : [];
      if (t === 'animal') rows = cleanAnimals(rows);
      if (rows.length) { await dbPutMany(t, rows); n += rows.length; }
    }
    await reload();
    await setMeta('lastImportAt', pkg.exportedAt || nowIso());
    return n;
  }
  const tables = {};
  TABLES.forEach((t) => {
    // v3.1：旧备份包不含 food 表 → 保留本机食物库（不清空），避免导入旧备份丢食物
    if (t === 'food' && !Array.isArray(pkg.tables[t])) {
      tables[t] = JSON.parse(JSON.stringify(S.food));
      return;
    }
    tables[t] = Array.isArray(pkg.tables[t]) ? pkg.tables[t] : [];
    if (t === 'animal') tables[t] = cleanAnimals(tables[t]);
  });
  await atomicReplace(tables);
  await reload();
  await setMeta('lastImportAt', pkg.exportedAt || nowIso());
}
// 恢复出厂
export async function factoryReset() {
  await clearAllData();
  const seeds = seedRows();
  for (const t of TABLES) await dbPutMany(t, seeds[t]);
  await reload();
}

/* ---- 备份包 ⇄ Excel 工作表（v2.2） ---- */
// 备份包 → Excel 工作表：首表 _meta 记录包信息，其余每张数据表一个工作表
export function backupToSheets(pkg) {
  const meta = [
    ['key', 'value'],
    ['app', pkg.app || ''],
    ['format', String(pkg.format || 1)],
    ['partial', pkg.partial ? 'true' : 'false'],
    ['exportedAt', pkg.exportedAt || ''],
    ['device', pkg.device || ''],
  ];
  Object.entries(pkg.counts || {}).forEach(([k, v]) => meta.push(['counts.' + k, String(v)]));
  const sheets = [{ name: '_meta', rows: meta }];
  TABLES.forEach((t) => {
    const rows = (pkg.tables || {})[t];
    if (!Array.isArray(rows)) return;
    sheets.push({ name: t, rows: rowsToSheet(rows) });
  });
  return sheets;
}
// Excel 工作表 → 备份包（_meta 缺失或非养个爬包时抛错）
export function backupFromSheets(sheets) {
  const list = (sheets || []).filter((s) => s && Array.isArray(s.rows));
  if (!list.length) throw new Error('Excel 文件中没有数据表');
  const metaSheet = list.find((s) => s.name === '_meta') || null;
  const meta = {};
  if (metaSheet) {
    sheetToRows(metaSheet.rows).forEach((r) => { if (r.key) meta[String(r.key)] = r.value; });
  }
  if (meta.app !== 'reptile-breeding') throw new Error('不是有效的养个爬备份包（Excel）');
  const tables = {};
  list.forEach((s) => {
    if (!metaSheet || s.name !== metaSheet.name) {
      if (TABLES.includes(s.name)) tables[s.name] = sheetToRows(s.rows);
    }
  });
  const counts = {};
  TABLES.forEach((t) => { if (t in tables) counts[t] = tables[t].length; });
  return {
    app: 'reptile-breeding',
    format: Number(meta.format) || 1,
    partial: meta.partial === 'true',
    exportedAt: meta.exportedAt || '',
    device: meta.device || '',
    counts,
    tables,
  };
}

/* ---- 个体分享包 ---- */
// opts.keepKeeper：导出时是否保留铲屎官名（默认不保留，避免泄露个人信息）
export function buildShare(animalId, opts = {}) {
  const a = getAnimal(animalId);
  if (!a) throw new Error('个体不存在');
  const photos = listPhotos(animalId).map((p) => ({ id: p.id, full: p.full, thumb: p.thumb, isThumbnail: p.isThumbnail }));
  const animal = {
    name: a.name, speciesId: a.speciesId, sex: a.sex,
    tagIds: [...(a.tagIds || [])], geneIds: [...(a.geneIds || [])], phenotype: a.phenotype || '',
    buyDate: a.buyDate, buyPrice: a.buyPrice, birthDate: a.birthDate, note: a.note,
    weight: a.weight, length: a.length,
    motherId: null, fatherId: null, cageId: null, // 分享包不含日志与谱系
  };
  if (opts.keepKeeper && a.keeper) animal.keeper = a.keeper;
  return {
    app: 'reptile-breeding-share',
    format: 1,
    exportedAt: nowIso(),
    animal,
    photos,
  };
}
export function validateShare(pkg) {
  if (!pkg || pkg.app !== 'reptile-breeding-share' || pkg.format !== 1) throw new Error('不是有效的个体分享包');
  if (!pkg.animal || !pkg.animal.name) throw new Error('分享包缺少个体信息');
  return true;
}
export async function importShare(pkg) {
  validateShare(pkg);
  const src = pkg.animal;
  // 物种/基因按 ID 命中，落空则按名称匹配，再落空则置空
  const mapRef = (table, id, name) => {
    if (id && S[table].some((r) => r.id === id)) return id;
    if (name) {
      const hit = S[table].find((r) => r.name === name);
      if (hit) return hit.id;
    }
    return null;
  };
  const speciesId = mapRef('species', src.speciesId, speciesName(src.speciesId));
  const geneIds = (src.geneIds || []).filter((gid) => S.gene.some((g) => g.id === gid));
  const tagIds = (src.tagIds || []).filter((tid) => S.tag.some((t) => t.id === tid));
  const row = {
    id: uuid(),
    code: nextAnimalCode(src.speciesId, geneIds),
    name: src.name, speciesId, sex: src.sex || 'unknown',
    tagIds, geneIds,
    keeper: src.keeper || getSetting('keeperName') || '',
    phenotype: src.phenotype || '',
    buyDate: src.buyDate || '', buyPrice: src.buyPrice == null ? null : Number(src.buyPrice),
    birthDate: src.birthDate || '', note: src.note || '',
    status: 'normal', soldPrice: null, soldCountInStats: true, soldDate: '',
    weight: src.weight == null ? null : Number(src.weight),
    length: src.length == null ? null : Number(src.length),
    cageId: null, motherId: null, fatherId: null,
    isArchived: false, archivedAt: '', archiveReason: '',
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  await dbPut('animal', row); S.animal.push(row);
  let n = 0;
  for (const p of (pkg.photos || []).slice(0, 3)) {
    if (!p.full) continue;
    await addPhoto(row.id, { full: p.full, thumb: p.thumb || p.full });
    n += 1;
  }
  return { animal: row, photoCount: n };
}

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
