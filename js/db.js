// db.js —— IndexedDB 封装（Web 端本地存储；App 端预留 SQLite 适配，接口保持一致）
// 数据模型：每张 objectStore = 一张逻辑表，keyPath='id'，value 为整行 JSON。
// 备份导入走单事务 clear+putAll，保证「全部成功或全部回滚」。
'use strict';

const DB_NAME = 'reptile-breeding';
// 版本演进（升级只增不删，保障用户数据不丢失）：
//   v1 初始 12 张表
//   v2 新增 pairing 配对记录表
//   v3 移除 morph 品系表（属性已从数据模型废弃，历史 morphId 字段保留但不再读取）
//   v4 新增 food 食物库表
const DB_VERSION = 4;

let _dbp = null;

export function openDB() {
  if (!_dbp) {
    _dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        // 业务表统一 keyPath='id'（UUID 字符串）
        ['species', 'gene', 'tag', 'animal', 'animal_photo', 'animal_log',
         'egg', 'pairing', 'cage_plan', 'cage', 'todo', 'bill', 'food'].forEach((s) => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        });
        // v3：品系表已从数据模型移除，删除该 store（不影响其他表数据）
        if (db.objectStoreNames.contains('morph')) db.deleteObjectStore('morph');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return _dbp;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务中止'));
  });
}

async function withStore(store, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(store, mode);
  const ret = fn(tx.objectStore(store));
  await txDone(tx);
  return ret;
}

/* ---------- 基础 CRUD ---------- */
export async function dbPut(store, obj) {
  return withStore(store, 'readwrite', (s) => s.put(obj));
}
export async function dbPutMany(store, arr) {
  return withStore(store, 'readwrite', (s) => { arr.forEach((o) => s.put(o)); });
}
export async function dbDel(store, id) {
  return withStore(store, 'readwrite', (s) => s.delete(id));
}
export async function dbDelMany(store, ids) {
  return withStore(store, 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); });
}
export async function dbAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export async function dbGet(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
export async function dbClear(store) {
  return withStore(store, 'readwrite', (s) => s.clear());
}

/* ---------- meta KV ---------- */
export async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function setMeta(key, val) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- 原子全量替换（备份导入用） ---------- */
// tables: { storeName: [rows...] } —— 单事务内 clear + 全量写入，任一步失败即整体回滚
export async function atomicReplace(tables) {
  const db = await openDB();
  const names = Object.keys(tables);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    names.forEach((name) => {
      const s = tx.objectStore(name);
      s.clear();
      (tables[name] || []).forEach((row) => s.put(row));
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务被中止，已回滚'));
  });
}

// 全量清空（谨慎使用，仅「恢复出厂」场景）
export async function clearAllData() {
  const db = await openDB();
  const names = ['species', 'gene', 'tag', 'animal', 'animal_photo', 'animal_log',
    'egg', 'pairing', 'cage_plan', 'cage', 'todo', 'bill', 'food'];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    names.forEach((n) => tx.objectStore(n).clear());
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
