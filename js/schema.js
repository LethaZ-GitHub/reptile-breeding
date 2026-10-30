// schema.js —— 表结构说明 + 内置种子数据（物种 / 基因 / 箱体规格）
// 对应需求文档第 4 章「数据库核心表结构」。
'use strict';

import { uuid } from './util.js';

export const TABLES = ['species', 'gene', 'tag', 'animal', 'animal_photo', 'animal_log',
  'egg', 'pairing', 'cage_plan', 'cage', 'todo', 'bill', 'food'];

/* ---------- 箱体规格预设（cm） ----------
   A3/A4/A6/R4/R6 行业无统一公开尺寸，以下为默认预设值，如需调整只改此处。
   cell=10cm：网格占用 = ceil(边长/10)，布局按网格近似。 */
export const CAGE_SPECS = {
  A3: { label: 'A3', l: 40, w: 28, h: 20 },
  A4: { label: 'A4', l: 50, w: 35, h: 23 },
  A6: { label: 'A6', l: 60, w: 40, h: 30 },
  R4: { label: 'R4', l: 36, w: 25, h: 18 },
  R6: { label: 'R6', l: 46, w: 32, h: 18 },
};
export const GRID_CELL_CM = 10;
export function specGrid(sizeType) {
  const s = CAGE_SPECS[sizeType] || CAGE_SPECS.A4;
  return { w: Math.ceil(s.l / GRID_CELL_CM), h: Math.ceil(s.w / GRID_CELL_CM) };
}

/* ---------- 爬柜清理周期（方案级设置） ---------- */
export const CLEAN_CYCLES = {
  week: { label: '每周', days: 7 },
  month: { label: '每月', days: 30 },
  quarter: { label: '每季', days: 90 },
  halfyear: { label: '每半年', days: 180 },
};
/* ---------- 孵化温度 → 预计孵化天数（仅这四个温度自动计算） ---------- */
export const HATCH_TEMP_DAYS = { 22: 90, 23: 80, 24: 70, 25: 60 };

/* ---------- 基因遗传类型（v2.0 起取消「多基因选育」） ----------
   显性 / 隐性 / 不完全显性 / 复合 遵循孟德尔遗传（预测为精确概率）。
   v1.7 引入的多基因选育为数量性状（非孟德尔，只能给估算值），v2.0 起整体取消：
   不可再新建/选择该类型，存量旧数据（自定义基因）仅作只读兼容展示，不参与预测。
   复合基因通过 comboOf 声明组分基因名，预测时按组分的「显现概率」乘积推导复合显现概率。
   v3.5 新增「杂合（het）」：隐性基因的单份携带状态。
   het 条目由隐性基因自动派生（名称 = 「隐」+ 隐性基因名，hetOf 指向对应隐性基因），
   预测时按隐性位点的 h 态（杂合携带）参与计算，与该隐性基因共享同一位点。 */
export const GENE_TYPES = {
  dominant: { label: '显性', desc: '携带一个拷贝即表现' },
  recessive: { label: '隐性', desc: '需双亲各传一个拷贝才表现' },
  het: { label: '杂合', desc: '隐性基因的单份携带（杂合），本身不表现，可传给后代' },
  incomplete: { label: '不完全显性', desc: '单拷贝表现，双拷贝为超级体（多有健康风险）' },
  combo: { label: '复合', desc: '多个基因组合表现（如 卡布奇诺+莉莉白=法布奇诺），按组分概率乘积推导' },
};
// 旧版多基因选育类型标识（v2.0 已取消，仅用于兼容展示存量数据）
export const LEGACY_GENE_TYPE = 'polygenic';

/* ---------- 内置种子 ---------- */
function seedSpecies() {
  return [
    { id: 'sp-crested', name: '睫角守宫', isCustom: false, createdAt: 'seed' },
    { id: 'sp-hognose', name: '猪鼻蛇', isCustom: false, createdAt: 'seed' },
  ];
}
export function seedGene() {
  // type: dominant / recessive / incomplete / combo / het（v3.5 新增杂合）
  // comboOf: 复合基因的组分基因名（同物种内按名称匹配）；为空表示组分未定义，预测时按隐性近似
  // hetOf: 杂合（het）基因所对应的隐性基因 id；普通基因为空字符串。
  //   所有内置行都显式写出 hetOf（普通行为 ''）——Excel 备份包的表头取「所有行键的并集」，
  //   若只有部分行有该字段，往返后其余行会被补上 hetOf: ""，导致备份包 JSON 比对不一致。
  // 睫角守宫基因库（2026-10 按用户指定清单重定义，v1.8 重建为孟德尔四类，v2.0 补充复合基因组分，
  // v2.2 补充「原色」野生型基准基因与更多复合基因登记名；v2.4 紫貂改为不完全显性——
  // 内置基因定义每次启动经 syncBuiltinGenes 强制覆盖存量数据，用户对内置基因的改动不保留）
  const c = [
    ['原色', 'Normal', 'dominant', '睫角基础基因', []],
    ['莉莉白', 'Lilly White', 'incomplete', '不完全显性基因，体表大面积白色纹路表现；双拷贝为超级莉莉白（通常无法正常孵化）。', []],
    ['卡布奇诺', 'Cappuccino', 'incomplete', '不完全显性基因，深咖啡色体色表现。', []],
    ['高速公路', 'Highway', 'incomplete', '不完全显性基因，体侧连贯条纹表现。', []],
    ['紫貂', 'Sable', 'incomplete', '不完全显性基因，体色加深、呈紫灰色调；双拷贝为超级紫貂。', []],
    ['缺黄', 'Axanthic', 'recessive', '隐性基因，消除黄红色素，呈灰黑色调；需双亲各携带一个拷贝。', []],
    ['巧克力', 'ChoCho', 'recessive', '隐性基因，幼体期暗红/巧克力色表现，随年龄加深。', []],
    ['法布奇诺', 'Frapuccino', 'combo', '复合基因：卡布奇诺 + 莉莉白组合表现。', ['卡布奇诺', '莉莉白']],
    ['缺黄莉莉', 'Axanthic Lilly White', 'combo', '复合基因：缺黄 + 莉莉白组合表现。', ['缺黄', '莉莉白']],
    ['缺黄卡布', 'Axanthic Cappuccino', 'combo', '复合基因：缺黄 + 卡布奇诺组合表现。', ['缺黄', '卡布奇诺']],
    ['缺黄紫貂莉莉', 'Axanthic Sable Lilly White', 'combo', '复合基因：缺黄 + 紫貂 + 莉莉白组合表现。', ['缺黄', '紫貂', '莉莉白']],
    ['猫屎咖啡', 'Luwak', 'combo', '复合基因：卡布奇诺+紫貂组合表现。', [ '卡布奇诺', '紫貂']],
    ['雪岳', 'Sorak', 'combo', '复合基因：莉莉白+超级卡布奇诺组合表现。', [ '莉莉白', '超级卡布奇诺']],
    ['Highway莉莉白', 'Highway Lilly White', 'combo', '复合基因：高速公路+莉莉白组合表现。', ['高速公路', '莉莉白']],
    ['紫貂缺黄', 'Sable Axanthic', 'combo', '复合基因：紫貂+缺黄组合表现。', ['紫貂', '缺黄']],
    ['紫貂莉莉', 'Sable Lilly White', 'combo', '复合基因：紫貂+莉莉白组合表现。', ['紫貂', '莉莉白']],
  ];
  const h = [
    ['原色', 'Normal', 'dominant', '猪鼻蛇基础基因', []],
    ['RBE蜡笔', 'RBE Pastel', 'dominant', '显性基因，主要影响体色表现，颜色更加柔和、明亮，并减少黑色素的沉积。', []],
    ['康达', 'Conda', 'incomplete', '不完全显性基因，主要影响花纹而不是颜色，总体趋势斑点减少、花纹简化。', []],
    ['北极', 'Arctic', 'incomplete', '不完全显性基因，表现为个体颜色整体变浅，斑纹颜色对比更强。，', []],
    ['白化', 'Albino', 'recessive', '隐性基因，黑色素完全确实，眼睛为红色或粉红色。', []],
    ['缺黄', 'Axanthic', 'recessive', '隐性基因，消除黄色素。', []],
    ['焦糖', 'Caramel', 'recessive', '隐性基因，焦糖棕色表现。', []],
    ['埃文斯海波', 'Evans Hypo', 'recessive', '隐性基因，黑色素缺乏单仍保持少量，通常呈黑色的区域，现在呈现出紫红色或灰色。', []],
    ['薰衣草', 'Lavender', 'recessive', '隐性基因，淡紫灰色表现。', []],
    ['巧克力', 'Chocolate', 'recessive', '隐性基因，表现出深棕色或者巧克力色底色', []],
    ['鲁西', 'Leucistic', 'recessive', '隐性基因，表现为个体通体雪白，没有任何色素和花纹，但保留黑色瞳孔', []],
    ['粉红蜡笔白化', 'Pink Pastel Albino', 'recessive', '隐性基因，属于白化类型的一种特定色彩变异，主要表现为更加温暖的粉色调增强效果', []],
    ['紫貂', 'Sable', 'recessive', '隐性基因，通常会在外观上影响色彩的深浅。', []],
    ['太妃', 'Toffee Belly', 'recessive', '隐性基因，通常具有黑色眼睛，黑色素合成能力大幅下降。', []],
    ['真海波', 'True Hypo', 'recessive', '隐性基因，眼睛为深棕色或黑色，身体表现出红棕色。', []],
    ['白化康达', 'Albino Anaconda', 'combo', '复合基因：白化+康达组合表现。', ['白化', '康达']],
    ['太阳爆炸', 'Sunburst', 'combo', '复合基因：紫貂+白化组合表现。', ['白化', '紫貂']],
  ];
  const base = [
    ...c.map(([name, en, type, desc, comboOf]) => ({ id: 'gn-c-' + en.toLowerCase().replace(/\s+/g, ''), speciesId: 'sp-crested', name, en, type, desc, comboOf: comboOf || [], isCustom: false })),
    ...h.map(([name, en, type, desc, comboOf]) => ({ id: 'gn-h-' + en.toLowerCase().replace(/\s+/g, ''), speciesId: 'sp-hognose', name, en, type, desc, comboOf: comboOf || [], isCustom: false })),
  ];
  // v3.5：为每个隐性基因自动派生一条杂合（het）基因
  //   名称 = 「隐」+ 隐性基因名；hetOf 指向对应隐性基因 id；
  //   het 与该隐性基因共享同一位点，预测时按 h 态（单份携带）参与孟德尔计算。
  //   派生行与普通行键集完全一致（普通行 hetOf 为空串），保证 Excel 备份包往返无损。
  const hets = base
    .filter((g) => g.type === 'recessive')
    .map((g) => ({
      id: g.id + '-het',
      speciesId: g.speciesId,
      name: '隐' + g.name,
      en: g.en + ' Het',
      type: 'het',
      desc: `杂合基因：「${g.name}」的单份携带（杂合）状态，本身不表现，可传给后代。`,
      comboOf: [],
      isCustom: false,
      hetOf: g.id,
    }));
  return [
    ...base.map((g) => ({ ...g, hetOf: '' })),
    ...hets,
  ];
}

export function seedRows() {
  return {
    species: seedSpecies(),
    gene: seedGene(),
    tag: [],
    animal: [],
    animal_photo: [],
    animal_log: [],
    egg: [],
    pairing: [],
    cage_plan: [],
    cage: [],
    todo: [],
    bill: [],
    food: seedFood(),
  };
}

/* ---------- 食物库内置种子（v3.1） ----------
   food 行结构：{ id, name, speciesId: [], isCustom, createdAt }
   speciesId 为空 = 通用食物（所有物种都显示）；否则仅对所选物种显示。 */
export function seedFood() {
  return [
    { id: 'fd-cricket', name: '白蟋蟀', speciesId: ['sp-crested'], isCustom: false, createdAt: 'seed' },
    { id: 'fd-fruitmix', name: '果泥', speciesId: ['sp-crested'], isCustom: false, createdAt: 'seed' },
    { id: 'fd-frozenmouse', name: '冻鼠', speciesId: ['sp-hognose'], isCustom: false, createdAt: 'seed' },
  ];
}
