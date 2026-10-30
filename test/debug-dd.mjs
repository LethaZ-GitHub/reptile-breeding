import { withBrowser } from './cdp.mjs';

const BASE = 'http://127.0.0.1:3250';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await withBrowser(async (p) => {
  await p.setViewport(390, 844);
  await p.goto(BASE + '/#/animal/new', 1800);
  await sleep(600);
  const r = await p.eval(`(() => {
    const out = [];
    document.querySelectorAll('.form-grid .field').forEach((f) => {
      const label = (f.querySelector('label') || {}).textContent || '';
      const pk = f.querySelector('.pk-btn');
      const inp = f.querySelector('input:not([type=hidden]), textarea');
      const native = f.querySelector('select');
      const tag = pk ? 'pk' : inp ? (inp.tagName === 'TEXTAREA' ? 'textarea' : 'input') : native ? 'native-only' : 'none';
      const el = pk || inp || native;
      const cs = el ? getComputedStyle(el) : null;
      out.push({
        label: label.trim().slice(0, 14),
        tag,
        h: el ? +el.getBoundingClientRect().height.toFixed(1) : 0,
        w: el ? +el.getBoundingClientRect().width.toFixed(1) : 0,
        pad: cs ? cs.padding : '',
        border: cs ? cs.borderTopWidth : '',
        fs: cs ? cs.fontSize : '',
        inMulti: !!f.querySelector('.multi'),
      });
    });
    return out;
  })()`);
  console.log('label | tag | h | w | padding | border | font | multi');
  r.forEach((x) => console.log([x.label, x.tag, x.h, x.w, x.pad, x.border, x.fs, x.inMulti ? 'Y' : ''].join(' | ')));
});
