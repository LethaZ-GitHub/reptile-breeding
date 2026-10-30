// genetics.js —— 基因配对预测引擎（孟德尔遗传）
// 模型：显性 / 隐性 / 不完全显性(超级体) / 复合 均按孟德尔分离定律计算精确概率；
//      复合基因（comboOf 声明组分）按组分基因参与计算（v2.3：父母本为复合基因时拆解为组分 locus）。
//      v2.0 起取消多基因选育（数量性状非孟德尔），不再参与预测。
// 状态：'v' 表现(视觉) / 'h' 携带(het，不表现) / 'n' 不携带；不完全显性另有 's' 超级体(双拷贝)
// v2.3：预测页不再手动选择基因状态，按遗传类型取默认状态（见 defaultGeneState）；
//       不完全显性双拷贝结果命名为「超级X」并给出健康风险提示。
// v2.4：隐性基因仅携带不显现时，基因名称加「隐」前缀（如 原色×缺黄 → 隐缺黄）；
//       行上打 super/hidden 标记，供结果表与导出图着色（超级体标红、携带不表现标蓝）。
// v2.5：基因性状列中超级体改为表达式（如 莉莉白+莉莉白，名称列仍为「超级莉莉白」）；
//       着色细化到「段」：仅超级/隐所在的基因段着色（如 莉莉白+隐缺黄 仅「隐缺黄」标蓝），
//       行上新增 nameParts:[{t,c}]（c=''|'super'|'hidden'）供 UI 逐段渲染；
//       复合基因继续按组分拆开参与计算，性状列只呈现拆分后的组分基因名。
'use strict';

/* ---------- 孟德尔分离表（Punnet 方阵精确概率） ---------- */
// 隐性：v=纯合表现，h=杂合携带
const RE = {
  'v,v': [['v', 1]],                    // 纯合 × 纯合 → 全部纯合表现
  'v,h': [['v', .5], ['h', .5]],        // 纯合 × 杂合 → 50% 纯合 / 50% 杂合
  'v,n': [['h', 1]],                    // 纯合 × 不携带 → 全部杂合携带
  'h,h': [['v', .25], ['h', .5], ['n', .25]],
  'h,n': [['h', .5], ['n', .5]],
  'n,n': [['n', 1]],
};
// 不完全显性：s=超级体(双拷贝)，h=单拷贝(表现)，n=不携带
const IN = {
  's,s': [['s', 1]],
  's,h': [['s', .5], ['h', .5]],
  's,n': [['h', 1]],
  'h,h': [['s', .25], ['h', .5], ['n', .25]],
  'h,n': [['h', .5], ['n', .5]],
  'n,n': [['n', 1]],
};
// 显性：只有 表现(v) / 不携带(n) 两态；视觉个体按杂合保守估算（v×v→100%表现，v×n→50%表现）
const DO = {
  'v,v': [['v', 1]],
  'v,n': [['v', .5], ['n', .5]],
  'n,n': [['n', 1]],
};

const LABEL = {
  v: '看得到', h: '看不到（携带）', n: '不携带', s: '超级体',
};

/* ---------- 各遗传类型可选的基因状态 ---------- */
// 显性只有「看得到 / 不携带」；不完全显性默认单拷贝（常态），超级体为特殊双拷贝；隐性/复合含杂合携带
export function geneStateOptions(type) {
  if (type === 'dominant') {
    return [{ value: 'v', label: '看得到（视觉）' }, { value: 'n', label: '不携带' }];
  }
  if (type === 'incomplete') {
    return [{ value: 'h', label: '看得到（单拷贝）' }, { value: 's', label: '超级体（双拷贝）' }, { value: 'n', label: '不携带' }];
  }
  return [{ value: 'v', label: '看得到（纯合）' }, { value: 'h', label: '看不到（携带）' }, { value: 'n', label: '不携带' }];
}
export function stateLabel(s) {
  return LABEL[s] || s;
}
// 结果标签：不完全显性的单拷贝(h)视觉上「看得到」，与隐性的杂合携带区分
export function outcomeLabel(type, s) {
  if (type === 'incomplete') {
    if (s === 'h') return '看得到（单拷贝）';
    if (s === 's') return '超级体（双拷贝）';
  } else if (s === 'v' && (type === 'recessive' || type === 'het')) {
    return '看得到（纯合）';
  }
  return LABEL[s] || s;
}

// 单基因后代分布（孟德尔精确概率）
export function geneOutcome(type, male, female) {
  let m = male, f = female;
  // v3.5：杂合（het）按隐性基因的分离律处理（同一隐性位点的单份携带）
  const t = type === 'het' ? 'recessive' : type;
  if (t === 'dominant') {
    // 显性只有「携带表现 / 不携带」两态，其余状态归一
    m = male === 'v' ? 'v' : 'n';
    f = female === 'v' ? 'v' : 'n';
  } else if (t === 'incomplete') {
    // 老数据/模糊选择曾用 'v' 表示「表现」：不完全显性的表现个体至少含一个拷贝，按单拷贝保守估算
    m = male === 'v' ? 'h' : male;
    f = female === 'v' ? 'h' : female;
  }
  const table = t === 'dominant' ? DO : t === 'incomplete' ? IN : RE;
  let k = m + ',' + f;
  let dist = table[k];
  if (!dist) {
    // 孟德尔分离对称：公母状态与表中键序相反时反序查找（如 'n,h' → 'h,n'、'n,v' → 'v,n'）
    dist = table[f + ',' + m];
  }
  return dist || [['n', 1]];
}

/* ---------- 显现概率（复合基因推导用） ---------- */
// 「显现」= 后代视觉上表现该基因：
//   显性/隐性/复合(按组分) → 'v' 纯合表现；不完全显性 → 'h' 单拷贝表现 + 's' 双拷贝超级体
export function expressProb(type, dist) {
  if (type === 'incomplete') {
    return dist.filter(([l]) => l === 'h' || l === 's').reduce((a, [, p]) => a + p, 0);
  }
  return dist.filter(([l]) => l === 'v').reduce((a, [, p]) => a + p, 0);
}

function sample(dist) {
  const r = Math.random();
  let acc = 0;
  for (const [label, p] of dist) {
    acc += p;
    if (r <= acc) return label;
  }
  return dist[dist.length - 1][0];
}

/**
 * 推导复合基因：组分基因全部入选且都有预测行时，按组分显现概率乘积计算复合基因显现概率。
 * @param {Array} genes   已入选并预测的基因 [{id, name, type, male, female, dist}]
 * @param {Array} speciesGenes 该物种基因库全部基因（含 comboOf 定义的复合基因）
 * @returns {Array} [{gene, comps:[names], prob}]  仅返回组分齐全的复合基因
 */
export function deriveCombos(genes, speciesGenes) {
  if (!Array.isArray(speciesGenes) || !speciesGenes.length) return [];
  const selected = new Map(genes.map((g) => [g.name, g]));
  const out = [];
  for (const g of speciesGenes) {
    // 仅推导基因库内有效基因（排除已失效/软删除）
    if (g.type !== 'combo' || g.isInvalid || selected.has(g.name)) continue;
    const comps = Array.isArray(g.comboOf) ? g.comboOf.filter(Boolean) : [];
    if (comps.length < 2) continue;
    if (!comps.every((n) => selected.has(n))) continue;
    let p = 1;
    for (const n of comps) {
      const c = selected.get(n);
      p *= expressProb(c.type, c.dist);
    }
    out.push({ gene: g, comps, prob: p });
  }
  return out;
}

/**
 * 预测整组配对
 * @param {Array} genes [{id, name, type, male, female}]  male/female ∈ v|h|n|s
 * @param {number} samples 蒙特卡洛抽样次数
 * @param {Array} speciesGenes 物种基因库（用于复合基因推导，可空）
 * @returns {{rows: Array, combos: Array, warnings: string[], combosDerived: Array}}
 */
export function predictPairing(genes, samples = 2000, speciesGenes = []) {
  const rows = [];
  const warnings = [];
  const simDists = [];

  genes.forEach((g) => {
    if (!g.type) return;
    const dist = geneOutcome(g.type, g.male, g.female);
    const items = dist.map(([label, p]) => ({
      label: outcomeLabel(g.type, label),
      prob: Math.round(p * 100),
      cls: label === 's' ? 'risk' : label === 'h' ? 'warn' : '',
      super: label === 's',
    }));
    rows.push({
      gene: g, type: g.type, items,
      approx: false,                   // 孟德尔精确概率
      dist,
    });
    simDists.push({ name: g.name, dist, type: g.type });
    if (g.type === 'incomplete' && dist.some(([l]) => l === 's')) {
      warnings.push(`「${g.name}」为不完全显性基因，本次配对有机会产生双拷贝超级体：超级体通常伴随健康风险（如超级莉莉白无法正常孵化、超级卡布奇诺有鼻腔/脊柱问题），建议避免超级配对。`);
    }
  });

  /* ---- 复合基因推导（组分齐全时按显现概率乘积） ---- */
  const derived = deriveCombos(genes.map((g) => ({ ...g, dist: geneOutcome(g.type, g.male, g.female) })), speciesGenes);
  const derivedRows = derived.map((d) => ({
    gene: d.gene, type: 'combo', derived: true, comps: d.comps,
    items: [{ label: '显现（组合表现）', prob: Math.round(d.prob * 100), cls: '', super: false }],
    approx: false,
  }));

  // 蒙特卡洛：组合表型 Top 5（假设各基因独立分配）
  const comboDefs = derived.map((d) => ({ name: d.gene.name, comps: d.comps }));
  const counter = new Map();
  for (let i = 0; i < samples; i++) {
    const expressed = [];
    simDists.forEach(({ name, dist, type }) => {
      const out = sample(dist);
      if (out === 'v') expressed.push(name);
      else if (out === 's') expressed.push('超级' + name);
      else if (out === 'h' && type === 'incomplete') expressed.push(name); // 不完全显性单拷贝即表现
    });
    // 复合基因：组分全部显现 → 复合基因显现
    comboDefs.forEach((cd) => {
      if (cd.comps.every((n) => expressed.includes(n))) expressed.push(cd.name);
    });
    const key = expressed.length ? expressed.slice().sort().join(' + ') : '普通表型（无目标基因表现）';
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  const combos = [...counter.entries()]
    .map(([label, n]) => ({ label, prob: Math.round((n / samples) * 100) }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 5);

  return { rows, combos, warnings, combosDerived: derivedRows };
}

export const GENE_STATES = [
  { value: 'v', label: '表现（视觉）' },
  { value: 'h', label: '携带（het，不表现）' },
  { value: 'n', label: '不携带' },
];

/* ---------- 杂合（het）基因（v3.5） ----------
   het 条目 = 隐性基因的单份携带（杂合）状态，本身不表现，但可传给后代。
   het 不是独立位点：它与对应隐性基因共享同一位点，携带时按该位点的 h 态参与计算。
   关联方式：hetOf 指向对应隐性基因的 id；兼容按「隐 + 隐性基因名」反查（导入的旧数据）。 */
export function hetBaseGene(gene, pool) {
  if (!gene || gene.type !== 'het') return null;
  const list = (pool || []).filter(Boolean);
  if (gene.hetOf) {
    const byId = list.find((g) => g.id === gene.hetOf);
    if (byId && byId.type === 'recessive') return byId;
  }
  const nm = String(gene.name || '');
  if (nm.startsWith('隐')) {
    const byName = list.find((g) => g.type === 'recessive' && g.name === nm.slice(1));
    if (byName) return byName;
  }
  return null;
}

/* ---------- 位点展开（统一入口） ----------
   复合基因 → 组分位点（各按遗传类型取默认状态）；
   杂合基因 → 对应隐性位点，状态固定为 h（单份携带）。 */
export function expandLoci(gene, pool) {
  const out = [];
  const base = hetBaseGene(gene, pool);
  if (base) {
    out.push({ id: base.id, name: base.name, type: base.type, state: 'h' });
    return out;
  }
  expandCombo(gene, pool).forEach((c) => {
    out.push({ id: c.id, name: c.name, type: c.type, state: defaultGeneState(c) });
  });
  return out;
}

/* ---------- 预测默认状态（v2.3 起预测不再手动选状态） ----------
   视觉个体按该类基因的常见基因型取默认值：
   显性 / 隐性 → 'v'（纯合表现：隐性可见必为纯合，显性可见按纯合保守估算）；
   不完全显性 → 'h'（单拷贝即表现，双拷贝为罕见的超级体）；
   杂合（het）→ 'h'（单份携带，不表现）。 */
export function defaultGeneState(gene) {
  if (!gene) return 'v';
  if (gene.type === 'incomplete') return 'h';
  if (gene.type === 'het') return 'h';
  return 'v';
}

/* ---------- 复合基因拆解（v2.3） ----------
   父母本为复合基因时，按 comboOf 声明的组分基因分别参与孟德尔计算：
   如母本「缺黄莉莉」→ 缺黄 + 莉莉白 两个 locus，父本「缺黄卡布」→ 缺黄 + 卡布奇诺。
   组分递归解析（组分仍是复合基因时继续拆）；任一组分名无法在基因库中解析
   （如误填状态名「超级卡布奇诺」）时，退回按原复合基因单 locus 隐性近似。 */
export function expandCombo(gene, pool) {
  if (!gene) return [];
  const byName = new Map((pool || []).filter(Boolean).map((g) => [g.name, g]));
  const out = [];
  const seen = new Set();
  const walk = (g, depth) => {
    if (!g || !g.id || depth > 4 || seen.has(g.id)) return;
    seen.add(g.id);
    const comps = g.type === 'combo' && Array.isArray(g.comboOf) ? g.comboOf.filter(Boolean) : [];
    const resolved = comps.map((n) => byName.get(n)).filter(Boolean);
    if (comps.length >= 2 && resolved.length === comps.length) {
      resolved.forEach((c) => walk(c, depth + 1));
      return;
    }
    out.push(g);   // 非复合 / 组分无法解析 → 按原基因单 locus
  };
  walk(gene, 0);
  return out.length ? out : [gene];
}

/* ---------- v2.2 后代结果精确枚举（多 locus 模型） ----------
   genes: [{ id?, name, type, male, female }]（公母各一个基因；公母同基因需先合并；
          某一侧未入选该基因时对应状态省略或为 'n'，按「不携带」处理——
          默认状态由调用方经 defaultGeneState 显式赋值，避免单方选基因被误判为双方携带）
   speciesGenes: 该物种基因库（用于复合基因命名匹配）
   返回 { rows: [{prob, probText, phenotype, name, nameParts, genes, super, hidden}], warnings }
   行规则：概率 | 基因性状（携带/显现的基因名以 + 连接，无则为「原色」）| 基因名称
          （基因库中已登记且组分完全一致的复合基因名，否则沿用性状）；
          不完全显性双拷贝('s)：性状列记为表达式「X+X」（如 莉莉白+莉莉白），名称列加「超级」
          前缀（如 超级莉莉白）；
          隐性基因杂合携带('h'，不显现)在名称中加「隐」前缀（如 隐缺黄）——
          含超级体或隐携带的行不匹配复合基因登记名（避免掩盖超级/携带状态）；
          super=含超级体（该段标红），hidden=含隐携带（该段标蓝）；
          nameParts 逐段拆分名称，仅超级/隐段带色标（v2.5：其余段不着色）。 */
export function predictOutcomes(genes, speciesGenes = []) {
  const list = (genes || []).filter((g) => g && g.name && (g.male !== 'n' || g.female !== 'n'));
  if (!list.length) return { rows: [], warnings: [] };
  const warnings = [];
  const blocks = list.map((g) => {
    // 某一侧未入选该基因 → 'n'（不携带）；默认状态由调用方显式传入
    const male = g.male || 'n';
    const female = g.female || 'n';
    const dist = geneOutcome(g.type, male, female);
    if (dist.some(([l]) => l === 's')) {
      warnings.push(`「${g.name}」本次配对有机会产生双拷贝超级体「超级${g.name}」：超级体通常伴随健康风险（如超级卡布奇诺有鼻腔/脊柱问题、超级莉莉白无法正常孵化），建议避免超级体配对。`);
    }
    return { gene: g, dist };
  });
  // 笛卡尔积：枚举所有后代基因组合（精确计算）
  let combos = [{ prob: 1, genes: [] }];
  for (const b of blocks) {
    const next = [];
    for (const c of combos) {
      for (const [label, p] of b.dist) {
        next.push({ prob: c.prob * p, genes: [...c.genes, { name: b.gene.name, type: b.gene.type, label }] });
      }
    }
    combos = next;
  }
  // 复合基因库：组分集合完全一致时采用其登记名
  const comboLib = (speciesGenes || []).filter((g) => g && g.type === 'combo' && Array.isArray(g.comboOf) && g.comboOf.filter(Boolean).length >= 2);
  const rows = [];
  for (const c of combos) {
    const carried = c.genes.filter((x) => x.label !== 'n');
    // 性状排序：看得到的在前（显性 v / 超级体 s / 不完全显性单拷贝 h），仅携带的在后（隐性杂合 h）
    const shown = carried.filter((x) => x.label !== 'h' || x.type === 'incomplete');
    const hidden = carried.filter((x) => !(x.label !== 'h' || x.type === 'incomplete'));
    const ordered = [...shown, ...hidden];
    // v2.3：不完全显性双拷贝在展示名上加「超级」前缀；
    // v2.4：隐性杂合携带（不显现）在名称中加「隐」前缀（仅名称列，性状列保持基因名）
    // v2.5：性状列超级体改为表达式「X+X」（莉莉白+莉莉白）；名称逐段拆分（nameParts），
    //       仅超级段（红）/ 隐段（蓝）带色标，其余段原色
    const dispName = (x) => (x.label === 's' ? x.name + '+' + x.name : x.name);
    const namePart = (x) => {
      if (x.label === 's') return '超级' + x.name;
      if (x.label === 'h' && x.type === 'recessive') return '隐' + x.name;
      return x.name;
    };
    const partCls = (x) => {
      if (x.label === 's') return 'super';
      if (x.label === 'h' && x.type === 'recessive') return 'hidden';
      return '';
    };
    const phenotype = ordered.length ? ordered.map(dispName).join('+') : '原色';
    // 复合基因登记名匹配规则（v3.5 回退至 v3.3 语义）
    //   组分集合与登记的 comboOf 完全一致 → 采用登记名（如 白化+康达 → 白化康达）。
    //   例外一：含超级体时不采用（超级康达 ≠ 康达，属另一种表现，须保留「超级」标注与健康风险提示）。
    //   例外二：组分中含「隐性仅携带不显现」时不采用登记名 —— 白化为隐性基因，
    //           必须携带两份才表现，「白化+康达」不能等同于「白化康达」，
    //           沿用 v2.4 起的既定语义显示为「康达+隐白化」。
    const hasSuper = carried.some((x) => x.label === 's');
    const hasHidden = carried.some((x) => x.label === 'h' && x.type === 'recessive');
    const nameSet = new Set(ordered.map((x) => x.name));
    const matched = comboLib.find((g) => {
      const s = new Set(g.comboOf.filter(Boolean));
      return s.size === nameSet.size && [...s].every((n) => nameSet.has(n));
    });
    const combo = matched && (!hasSuper) && (!hasHidden) ? matched : null;
    // 复合基因登记名整段一个 part（登记名本身不含超级/隐，不会与色标冲突）
    const nameParts = combo ? [{ t: combo.name, c: '' }] : ordered.map((x) => ({ t: namePart(x), c: partCls(x) }));
    const name = combo ? combo.name : (ordered.length ? ordered.map(namePart).join('+') : '原色');
    const exist = rows.find((r) => r.phenotype === phenotype && r.name === name);
    if (exist) exist.prob += c.prob;
    else rows.push({ prob: c.prob, phenotype, name, nameParts, genes: c.genes.map((x) => ({ name: x.name, label: x.label })), super: hasSuper, hidden: hasHidden, combo: !!combo });
  }
  rows.sort((a, b) => b.prob - a.prob || a.phenotype.localeCompare(b.phenotype, 'zh'));
  // 百分比取 1 位小数，取整误差并到概率最大的一行
  const pcts = rows.map((r) => Math.round(r.prob * 1000) / 10);
  const sum = pcts.reduce((s, v) => s + v, 0);
  const diff = Math.round((100 - sum) * 10) / 10;
  if (diff !== 0 && pcts.length) {
    let mi = 0;
    pcts.forEach((v, i) => { if (v > pcts[mi]) mi = i; });
    pcts[mi] = Math.round((pcts[mi] + diff) * 10) / 10;
  }
  rows.forEach((r, i) => { r.probText = (Number.isInteger(pcts[i]) ? String(pcts[i]) : pcts[i].toFixed(1)) + '%'; });
  return { rows, warnings };
}
