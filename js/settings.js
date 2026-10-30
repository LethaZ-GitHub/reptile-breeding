// settings.js —— 全局偏好（localStorage，设备本地）：单位 / 明暗主题 / 报表开关
// 说明：偏好属设备级设置，不随备份包迁移（数据才走备份），Web 与 App 各自保存。
'use strict';

const KEY = 'rb-settings';
const DEFAULTS = {
  theme: 'light',        // light | dark
  weightUnit: 'g',       // g | oz
  lengthUnit: 'cm',      // cm | inch
  countSoldIncome: false, // 报表是否纳入已售出个体售出收入
  keeperName: '',        // 铲屎官名（新建个体默认填入，可逐个修改）
};

let cache = { ...DEFAULTS };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) cache = { ...DEFAULTS, ...JSON.parse(raw) };
} catch (e) { /* ignore */ }
// 取值归一（v2.6）：非法/缺失一律回落默认值——体重默认克、体长默认厘米、主题默认浅色
if (cache.weightUnit !== 'g' && cache.weightUnit !== 'oz') cache.weightUnit = 'g';
if (cache.lengthUnit !== 'cm' && cache.lengthUnit !== 'inch') cache.lengthUnit = 'cm';
if (cache.theme !== 'light' && cache.theme !== 'dark') cache.theme = 'light';

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
}

export function getSetting(key) { return cache[key]; }
export function setSetting(key, val) { cache[key] = val; persist(); }
export function allSettings() { return { ...cache }; }

export function applyTheme() {
  document.documentElement.dataset.theme = cache.theme === 'dark' ? 'dark' : 'light';
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = cache.theme === 'dark' ? '☀️' : '🌙';
}
export function toggleTheme() {
  cache.theme = cache.theme === 'dark' ? 'light' : 'dark';
  persist(); applyTheme();
}

/* ---------- 单位换算（内部统一存储 g / cm） ---------- */
const G_PER_OZ = 28.349523125;
const CM_PER_INCH = 2.54;

// 存储值(g) -> 展示值
export function dispWeight(g) {
  if (g == null || g === '') return '';
  const v = cache.weightUnit === 'oz' ? (Number(g) / G_PER_OZ) : Number(g);
  return trimNum(v);
}
// 展示值 -> 存储值(g)
export function storeWeight(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return cache.weightUnit === 'oz' ? Math.round(n * G_PER_OZ * 100) / 100 : n;
}
export function dispLength(cm) {
  if (cm == null || cm === '') return '';
  const v = cache.lengthUnit === 'inch' ? (Number(cm) / CM_PER_INCH) : Number(cm);
  return trimNum(v);
}
export function storeLength(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return cache.lengthUnit === 'inch' ? Math.round(n * CM_PER_INCH * 100) / 100 : n;
}
export function unitWeight() { return cache.weightUnit; }
export function unitLength() { return cache.lengthUnit; }
function trimNum(v) {
  return Math.round(v * 100) / 100;
}
