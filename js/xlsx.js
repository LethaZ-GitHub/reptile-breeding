// xlsx.js —— 纯 JS 的 Excel(.xlsx) 读写（无第三方依赖）
// 写入：ZIP（stored 不压缩）+ SpreadsheetML XML（内联字符串，无需 sharedStrings）
// 读取：ZIP 中央目录解析 + DecompressionStream('deflate-raw') 解压 + DOMParser 解析
// 兼容：本模块生成的文件可被 Excel / WPS 直接打开；Excel/WPS 另存的文件也可读回
'use strict';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TRUNC_MARK = '…[过长已截断]';   // Excel 单元格上限 32767 字符，超长截断标记
const CELL_MAX = 32000;

/* ================= 写入 ================= */
// sheets: [{ name, rows: [[cell]] }] → Uint8Array（.xlsx 文件字节）
export function buildXlsx(sheets) {
  const list = (sheets || []).filter((s) => s && s.name && Array.isArray(s.rows)).map((s) => ({ name: safeSheetName(s.name), rows: s.rows }));
  const enc = new TextEncoder();
  const parts = [];
  const add = (name, xml) => parts.push({ name, data: enc.encode(xml) });

  const sheetOverrides = list.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${sheetOverrides}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>养个爬</dc:creator><cp:lastModifiedBy>养个爬</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xmlAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml', STYLES_XML);
  list.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zipStore(parts);
}
export function xlsxBlob(sheets) {
  return new Blob([buildXlsx(sheets)], { type: XLSX_MIME });
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/* ---- ZIP（stored）打包 ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(parts) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const p of parts) {
    const nameBytes = enc.encode(p.name);
    const crc = crc32(p.data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true);   // UTF-8 文件名
    dv.setUint16(8, 0, true);        // stored
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, p.data.length, true);
    dv.setUint32(22, p.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    chunks.push(lh, p.data);
    const cd = new Uint8Array(46 + nameBytes.length);
    const dv2 = new DataView(cd.buffer);
    dv2.setUint32(0, 0x02014b50, true);
    dv2.setUint16(4, 20, true);
    dv2.setUint16(6, 20, true);
    dv2.setUint16(8, 0x0800, true);
    dv2.setUint16(10, 0, true);
    dv2.setUint16(12, dosTime, true);
    dv2.setUint16(14, dosDate, true);
    dv2.setUint32(16, crc, true);
    dv2.setUint32(20, p.data.length, true);
    dv2.setUint32(24, p.data.length, true);
    dv2.setUint16(28, nameBytes.length, true);
    dv2.setUint16(30, 0, true);
    dv2.setUint16(32, 0, true);
    dv2.setUint16(34, 0, true);
    dv2.setUint16(36, 0, true);
    dv2.setUint32(38, 0, true);
    dv2.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += lh.length + p.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const dv3 = new DataView(eocd.buffer);
  dv3.setUint32(0, 0x06054b50, true);
  dv3.setUint16(4, 0, true);
  dv3.setUint16(6, 0, true);
  dv3.setUint16(8, parts.length, true);
  dv3.setUint16(10, parts.length, true);
  dv3.setUint32(12, cdSize, true);
  dv3.setUint32(16, offset, true);
  dv3.setUint16(20, 0, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

/* ---- 单元格 / 工作表 XML ---- */
function colName(i) { // 0 → A
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function xmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function xmlAttr(s) { return xmlText(s).replace(/"/g, '&quot;'); }
function safeSheetName(name) {
  let s = String(name || 'Sheet1').replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
  return s || 'Sheet1';
}
function cellXml(ref, v, header) {
  if (v === null || v === undefined || v === '') return '';
  const s = header ? ' s="1"' : '';
  if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  let str = typeof v === 'string' ? v : JSON.stringify(v);
  if (str.length > CELL_MAX) str = str.slice(0, CELL_MAX) + TRUNC_MARK;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(str)}</t></is></c>`;
}
function sheetXml(sheet) {
  const cols = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const colXml = cols
    ? `<cols>${Array.from({ length: cols }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="20" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rowsXml = sheet.rows.map((row, ri) => {
    const cells = row.map((v, ci) => cellXml(`${colName(ci)}${ri + 1}`, v, ri === 0)).filter(Boolean).join('');
    return cells ? `<row r="${ri + 1}">${cells}</row>` : '';
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colXml}<sheetData>${rowsXml}</sheetData></worksheet>`;
}

/* ================= 读取 ================= */
// file: File/Blob → { sheets: [{name, rows}] }
export async function readXlsxFile(file) {
  const buf = await file.arrayBuffer();
  return parseXlsx(buf);
}
export async function parseXlsx(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = readZipEntries(bytes);           // [{name, method, raw}]
  const files = new Map();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    files.set(e.name, e.method === 0 ? e.raw : await inflateRaw(e.raw));
  }
  const dec = new TextDecoder();
  const doc = (name) => {
    const b = files.get(name);
    if (!b) return null;
    try { return new DOMParser().parseFromString(dec.decode(b), 'application/xml'); } catch (e) { return null; }
  };
  // sharedStrings（Excel/WPS 另存的文件用）
  const shared = [];
  const ssDoc = doc('xl/sharedStrings.xml');
  if (ssDoc) {
    ssDoc.querySelectorAll('si').forEach((si) => {
      let t = '';
      si.querySelectorAll('t').forEach((n) => { t += n.textContent || ''; });
      shared.push(t);
    });
  }
  // 工作表清单（workbook.xml + rels 映射）
  const rels = {};
  const relsDoc = doc('xl/_rels/workbook.xml.rels');
  if (relsDoc) {
    relsDoc.querySelectorAll('Relationship').forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
  }
  const sheetRefs = [];
  const wbDoc = doc('xl/workbook.xml');
  if (wbDoc) {
    wbDoc.querySelectorAll('sheets > sheet').forEach((sh, i) => {
      const rid = sh.getAttribute('r:id') || sh.getAttribute('id') || '';
      let target = rels[rid] || ('worksheets/sheet' + (sh.getAttribute('sheetId') || (i + 1)) + '.xml');
      if (target.startsWith('/')) target = target.slice(1); else target = 'xl/' + target;
      sheetRefs.push({ name: sh.getAttribute('name') || '', path: target });
    });
  }
  if (!sheetRefs.length) {
    let i = 1;
    while (files.has(`xl/worksheets/sheet${i}.xml`)) { sheetRefs.push({ name: '', path: `xl/worksheets/sheet${i}.xml` }); i += 1; }
  }
  const sheets = [];
  for (const ref of sheetRefs) {
    const sDoc = doc(ref.path);
    if (!sDoc) continue;
    const rows = [];
    sDoc.querySelectorAll('sheetData > row').forEach((rowEl) => {
      const row = [];
      rowEl.querySelectorAll('c').forEach((c) => {
        const m = (c.getAttribute('r') || '').match(/^([A-Z]+)(\d+)$/);
        const idx = m ? colIndex(m[1]) : row.length;
        const t = c.getAttribute('t');
        const vEl = c.querySelector('v');
        let val = null;
        if (t === 'inlineStr') {
          const is = c.querySelector('is');
          val = is ? (is.textContent || '') : '';
        } else if (t === 's') {
          val = shared[Number(vEl ? vEl.textContent : -1)] || '';
        } else if (t === 'b') {
          val = vEl ? vEl.textContent === '1' : false;
        } else if (t === 'str' || t === 'e') {
          val = t === 'e' ? null : (vEl ? vEl.textContent : '');
        } else if (vEl) {
          const raw = vEl.textContent;
          const num = Number(raw);
          val = raw !== '' && isFinite(num) ? num : raw;
        }
        if (typeof val === 'string') val = restoreCell(val);
        while (row.length < idx) row.push(null);
        row[idx] = val;
      });
      rows.push(row);
    });
    sheets.push({ name: ref.name, rows });
  }
  if (!sheets.length) throw new Error('xlsx 文件中没有数据表');
  return { sheets };
}
async function inflateRaw(raw) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前系统不支持读取压缩的 Excel 文件，请升级系统 WebView 或改用 JSON 备份');
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// ZIP 中央目录 → 条目清单（含本地数据偏移）
function readZipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（ZIP 结构损坏）');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length) break;
    if (!(bytes[p] === 0x50 && bytes[p + 1] === 0x4b && bytes[p + 2] === 0x01 && bytes[p + 3] === 0x02)) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const namelen = dv.getUint16(p + 28, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + namelen));
    const lnamelen = dv.getUint16(lho + 26, true);
    const lextralen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnamelen + lextralen;
    out.push({ name, method, raw: bytes.subarray(start, start + csize) });
    p += 46 + namelen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  if (!out.length) throw new Error('xlsx 文件内容为空');
  return out;
}
// 单元格文本还原：截断标记 → 空；JSON 形态字符串 → 解析回数组/对象
function restoreCell(s) {
  if (s.endsWith(TRUNC_MARK)) return '';
  const t = s.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.parse(t); } catch (e) { return s; }
  }
  return s;
}

/* ================= 对象数组 ⇄ 二维表 ================= */
// 对象数组 → 二维表（首行表头 = 键并集，保持首见顺序）
export function rowsToSheet(rows) {
  const list = (rows || []).filter((r) => r && typeof r === 'object');
  const keys = [];
  list.forEach((r) => Object.keys(r).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  const out = [keys];
  list.forEach((r) => out.push(keys.map((k) => (r[k] === undefined ? null : r[k]))));
  return out;
}
// 二维表 → 对象数组（首行表头；跳过空行）
export function sheetToRows(sheetRows) {
  const rows = sheetRows || [];
  if (!rows.length) return [];
  const header = rows[0].map((h) => (h === null || h === undefined ? '' : String(h).trim()));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === null || c === undefined || c === '')) continue;
    const obj = {};
    header.forEach((k, ci) => {
      if (!k) return;
      const v = row[ci];
      obj[k] = v === undefined || v === null ? '' : v;
    });
    out.push(obj);
  }
  return out;
}
