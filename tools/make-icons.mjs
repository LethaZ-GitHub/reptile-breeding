// tools/make-icons.mjs —— 生成 PWA 图标（纯 Node 软件光栅化 + 自写 PNG 编码，零依赖、确定性输出）
// 用法：node tools/make-icons.mjs
// 产出：icons/icon-192.png, icons/icon-512.png, icons/apple-touch-180.png
// 说明：图案 = 林绿渐变底 + 奶油色剪影睫角守宫（全出血居中，兼容 maskable 安全区）。
// 曾试过 CDP 驱动无头 Edge 截图栅格化，遇到"页面导航不刷新/渲染尺寸漂移"问题，故改为纯 Node 光栅化。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'icons');

const C1 = [0x34, 0xb8, 0x7c]; // 渐变起点
const C2 = [0x22, 0x79, 0x4f]; // 渐变终点
const LIZARD = [0xf3, 0xec, 0xd9]; // 剪影奶油色
const EYE = [0x22, 0x79, 0x4f];

/* ---------- 几何（512 坐标系） ---------- */
function inEllipse(x, y, cx, cy, rx, ry, deg) {
  const t = (deg || 0) * Math.PI / 180;
  const dx = x - cx, dy = y - cy;
  const a = dx * Math.cos(t) + dy * Math.sin(t);
  const b = -dx * Math.sin(t) + dy * Math.cos(t);
  return (a * a) / (rx * rx) + (b * b) / (ry * ry) <= 1;
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}
// 尾巴新月形：外曲线 + 内曲线组成闭合多边形
function tailPolygon(n = 48) {
  const outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    outer.push(cubic([236, 322], [176, 316], [132, 272], [112, 218], t));
    inner.push(cubic([236, 306], [200, 296], [152, 268], [112, 218], t));
  }
  return outer.concat(inner.reverse());
}

const TAIL = tailPolygon();
function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function lizardAt(x, y) {
  // 命中剪影（在白/透明外追加 lizard 色）
  if (inEllipse(x, y, 268, 262, 56, 92, -12)) return true;            // 身体
  if (inEllipse(x, y, 240, 158, 46, 46, 0)) return true;              // 头
  if (inEllipse(x, y, 196, 218, 44, 17, -35)) return true;            // 前左上肢
  if (inEllipse(x, y, 322, 214, 44, 17, 35)) return true;             // 前右上肢
  if (inEllipse(x, y, 200, 300, 44, 17, 32)) return true;             // 后左下肢
  if (inEllipse(x, y, 330, 298, 44, 17, -32)) return true;            // 后右下肢
  if (pointInPoly(TAIL, x, y)) return true;                           // 尾巴
  return false;
}
function isEye(x, y) {
  return inEllipse(x, y, 228, 148, 7, 7, 0) || inEllipse(x, y, 254, 148, 7, 7, 0);
}

/* ---------- 光栅化（SS 超采样抗锯齿） ---------- */
function rasterize(size, outFile) {
  const S = size, K = 4; // 每像素 4x4 超采样
  const px = Buffer.alloc(S * S * 3);
  const inv = 1 / (K * K);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < K; sy++) {
        for (let sx = 0; sx < K; sx++) {
          const fx = (x + (sx + 0.5) / K) / S * 512;
          const fy = (y + (sy + 0.5) / K) / S * 512;
          let col;
          if (isEye(fx, fy)) col = EYE;
          else if (lizardAt(fx, fy)) col = LIZARD;
          else {
            const t = (fx + fy) / 1024;
            col = [C1[0] + (C2[0] - C1[0]) * t, C1[1] + (C2[1] - C1[1]) * t, C1[2] + (C2[2] - C1[2]) * t].map((v) => Math.round(v));
          }
          r += col[0]; g += col[1]; b += col[2];
        }
      }
      const i = (y * S + x) * 3;
      px[i] = r * inv; px[i + 1] = g * inv; px[i + 2] = b * inv;
    }
  }
  fs.writeFileSync(outFile, encodePng(px, S, S));
}

/* ---------- 极简 PNG 编码器（RGB 8bit / filter 0 / 单 IDAT） ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), rgb.slice(y * w * 3, (y + 1) * w * 3));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 主流程 ---------- */
if (import.meta.filename === process.argv[1]) {
  fs.mkdirSync(OUT, { recursive: true });
  const targets = [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-180.png']];
  for (const [size, name] of targets) {
    const out = path.join(OUT, name);
    rasterize(size, out);
    const b = fs.readFileSync(out);
    if (b.slice(1, 4).toString() !== 'PNG') throw new Error('PNG 头无效: ' + name);
    if (b.readUInt32BE(16) !== size) throw new Error('PNG 宽不符: ' + name);
    console.log('OK', name, `${size}x${size}`, b.length + 'B');
  }
}
