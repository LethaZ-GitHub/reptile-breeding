// test/v34-shots.mjs —— v3.4 五项需求的交付截图
//   1. 导航页 logo（logo-g.png）+ 更多页（无「月度报表」入口）
//   2. License 双语弹窗
//   3. 猪鼻蛇复合基因预测结果（「白化康达」登记名 + 仅携带蓝字）
//   4. 启动页（安卓原生层，无法在浏览器截取 —— 用 logo 资源图代替说明）
import { withBrowser } from './cdp.mjs';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3241/';
const OUT = 'test/shots-v34';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await withBrowser(async (api) => {
  await api.goto(BASE + '#/home', 1800);
  await sleep(800);

  // 1-A. 桌面端顶栏 logo（品牌区）
  await api.shot(`${OUT}/desktop-home-logo.png`, { width: 1440, height: 900 });

  // 1-B. 桌面端侧栏 logo（完整导航，可见无「月度报表」）
  await api.shot(`${OUT}/desktop-sidebar.png`, { width: 1440, height: 900 });

  // 1-C. 手机端首页（顶栏 logo）
  await api.setViewport(390, 844, false);
  await api.goto(BASE + '#/home', 1400);
  await sleep(600);
  await api.shot(`${OUT}/mobile-home-logo.png`, { width: 390, height: 844 });

  // 1-D. 手机端更多页（无「月度报表」入口）
  await api.goto(BASE + '#/more', 1500);
  await sleep(700);
  await api.shot(`${OUT}/mobile-more.png`, { width: 390, height: 844 });

  // 2. License 双语弹窗（桌面端，看得清全文）
  await api.setViewport(1440, 900, false);
  await api.goto(BASE + '#/more', 1500);
  await sleep(700);
  await api.eval(`(() => { const a = document.getElementById('about-license-btn'); if (a) a.click(); })()`, { awaitPromise: false });
  await sleep(1000);
  await api.shot(`${OUT}/desktop-license.png`, { width: 1440, height: 900 });
  // 滚到中文对照部分
  await api.eval(`(() => { const pre = document.querySelector('.license-text'); if (pre) pre.scrollTop = pre.scrollHeight * 0.55; })()`, { awaitPromise: false });
  await sleep(400);
  await api.shot(`${OUT}/desktop-license-cn.png`, { width: 1440, height: 900 });
  await api.eval(`document.querySelectorAll('.modal-mask').forEach((m) => m.remove())`, { awaitPromise: false });

  // 3. 猪鼻蛇复合基因预测结果
  await api.goto(BASE + '#/predict', 1800);
  await sleep(900);
  await api.eval(`(() => {
    const s = document.getElementById('f-species');
    const o = [...s.options].find((x) => x.textContent.includes('猪鼻'));
    if (o) { s.value = o.value; s.dispatchEvent(new Event('change', {bubbles:true})); }
  })()`, { awaitPromise: false });
  await sleep(900);
  await api.eval(`(() => {
    const pick = (side, label) => {
      const box = document.getElementById(side + '-box');
      const sel = box.querySelector('.g-sel');
      const opt = [...sel.options].find((o) => o.textContent.replace(/（.*$/, '') === label);
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles:true})); }
    };
    pick('male', '白化');
    pick('female', '康达');
    document.getElementById('btn-run').click();
  })()`, { awaitPromise: false });
  await sleep(1400);
  await api.shot(`${OUT}/desktop-predict-combo.png`, { width: 1440, height: 900 });
  await api.setViewport(390, 844, false);
  await sleep(500);
  await api.shot(`${OUT}/mobile-predict-combo.png`, { width: 390, height: 844 });

  console.log('ALL SHOTS DONE');
}, { port: 9222 });
