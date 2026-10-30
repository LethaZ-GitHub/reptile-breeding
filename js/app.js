// app.js —— 应用入口：导航渲染 + hash 路由 + 全局 App 对象
'use strict';

import { initStore, refreshAutoTodos, pendingTodoCount } from './store.js';
import { applyTheme, toggleTheme } from './settings.js';
import { toast } from './util.js';
import { installPicker } from './picker.js';
import { installLightbox, closeZoomViewer } from './lightbox.js';
import { maybeShowUpdateNotice } from './update-notice.js';
import Pages from './pages/index.js';

/* ---------------- 路由表 ---------------- */
const ROUTES = [
  { re: /^#\/home$/, key: 'home' },
  { re: /^#\/animals$/, key: 'animals', params: { tab: 'active' } },
  { re: /^#\/animals\/archive$/, key: 'animals', params: { tab: 'archived' } },
  { re: /^#\/animal\/new$/, key: 'animalForm', params: { mode: 'new' } },
  { re: /^#\/animal\/edit\/(.+)$/, key: 'animalForm', params: { mode: 'edit' } },
  { re: /^#\/animal\/clone\/(.+)$/, key: 'animalForm', params: { mode: 'clone' } },
  { re: /^#\/animal\/(.+)$/, key: 'animalDetail' },
  { re: /^#\/eggs$/, key: 'eggs', params: { tab: 'active' } },
  { re: /^#\/eggs\/archive$/, key: 'eggs', params: { tab: 'archived' } },
  { re: /^#\/egg\/(.+)$/, key: 'eggDetail' },
  { re: /^#\/cages$/, key: 'cages' },
  { re: /^#\/cage\/(.+)$/, key: 'cageEditor' },
  { re: /^#\/predict$/, key: 'predict' },
  { re: /^#\/genes$/, key: 'genes' },
  { re: /^#\/species$/, key: 'species' },
  { re: /^#\/pairings$/, key: 'pairings' },
  { re: /^#\/tags$/, key: 'tags' },
  { re: /^#\/growth$/, key: 'growth' },
  { re: /^#\/logs$/, key: 'logs' },
  { re: /^#\/bills$/, key: 'bills' },
  { re: /^#\/reports$/, key: 'reports' },
  { re: /^#\/backup$/, key: 'backup' },
  { re: /^#\/share$/, key: 'share' },
  { re: /^#\/todos$/, key: 'todos' },
  { re: /^#\/settings$/, key: 'settings' },
  { re: /^#\/more$/, key: 'more' },
];

const NAV = [
  { title: '概览', items: [{ ico: '🏠', label: '首页待办', route: '#/home', badge: true }] },
  {
    title: '个体', items: [
      { ico: '🦎', label: '个体列表', route: '#/animals' },
      { ico: '🥚', label: '蛋管理', route: '#/eggs' },
    ],
  },
  { title: '爬柜', items: [{ ico: '🏡', label: '爬柜方案', route: '#/cages' }] },
  {
    // v3.3：补齐电脑端缺失的功能入口（成长记录 / 饲养日志 / 工单管理）
    title: '记录', items: [
      { ico: '📈', label: '成长记录', route: '#/growth' },
      { ico: '📖', label: '饲养日志', route: '#/logs' },
      { ico: '📋', label: '工单管理', route: '#/todos' },
      { ico: '💞', label: '配对记录', route: '#/pairings' },
    ],
  },
  {
    title: '基因', items: [
      { ico: '🧬', label: '基因预测', route: '#/predict' },
      { ico: '📚', label: '基因库', route: '#/genes' },
      { ico: '🔬', label: '物种库', route: '#/species' },
      { ico: '🏷️', label: '标签管理', route: '#/tags' },
    ],
  },
  {
    title: '财务', items: [
      // v3.4：月度报表已集成进「记账报表」，不再单独设入口（路由 #/reports 仍保留）
      { ico: '💰', label: '记账报表', route: '#/bills' },
    ],
  },
  {
    title: '系统', items: [
      { ico: '💾', label: '备份与恢复', route: '#/backup' },
      { ico: '📤', label: '个体分享', route: '#/share' },
      { ico: '⚙️', label: '设置', route: '#/settings' },
      { ico: '⋯', label: '更多功能', route: '#/more' },
    ],
  },
];

const BOTTOM = [
  { ico: '🥚', label: '蛋管理', route: '#/eggs' },
  { ico: '🦎', label: '个体管理', route: '#/animals' },
  { ico: '🏠', label: '首页', route: '#/home', center: true },
  { ico: '💞', label: '配对记录', route: '#/pairings' },
  { ico: '⋯', label: '更多', route: '#/more' },
];

/* ---------------- 全局对象 ---------------- */
export const App = {
  go(route) { location.hash = route; },
  refresh() { renderRoute(true); },
  toast,
};

/* ---------------- 导航渲染 ---------------- */
// 「更多」页收录的功能路由（进入这些页面时底部「更多」保持高亮）
// v2.7：配对记录移入底部菜单（不再属于更多）；记账移入更多页（改名记账报表）
const MORE_ROUTES = ['#/cages', '#/predict', '#/genes', '#/species', '#/tags', '#/growth', '#/logs', '#/todos', '#/bills', '#/reports', '#/backup', '#/share', '#/settings'];

/* 一级页面（底部导航 / 侧栏入口）：这些页面不显示左上角返回按钮 */
const TOP_ROUTES = ['#/home', '#/animals', '#/eggs', '#/pairings', '#/more'];

/* 顶栏返回按钮：二级页面显示，点击回退历史；无历史可退时回首页 */
function syncBackBtn(hash) {
  const btn = document.getElementById('btn-back');
  if (!btn) return;
  const top = TOP_ROUTES.includes(hash);
  btn.hidden = top;
  btn.onclick = () => {
    if (window.history.length > 1) window.history.back();
    else App.go('#/home');
  };
}

function navActive(route) {
  const h = location.hash || '#/home';
  if (h === route) return true;
  if (route === '#/animals' && (/^#\/animals(\/archive)?$/.test(h) || /^#\/animal\/(new|edit|clone|[^/]+)$/.test(h))) return true;
  if (route === '#/eggs' && (/^#\/eggs(\/archive)?$/.test(h) || /^#\/egg\/[^/]+$/.test(h))) return true;
  if (route === '#/cages' && /^#\/cage\/[^/]+$/.test(h)) return true;
  if (route === '#/more' && (h.startsWith('#/cage/') || MORE_ROUTES.includes(h))) return true;
  return false;
}

function renderNav() {
  const badge = pendingTodoCount();
  const sb = document.getElementById('sidebar');
  sb.innerHTML = `
    <div class="sb-logo"><span class="tb-logo"><img src="icons/logo-g.png" alt="养个爬"></span>养个爬</div>
    ${NAV.map((g) => `
      <div class="sb-group">
        <div class="sb-group-title">${g.title}</div>
        ${g.items.map((it) => `
          <div class="sb-item ${navActive(it.route) ? 'active' : ''}" data-route="${it.route}">
            <span class="sb-ico">${it.ico}</span>${it.label}
            ${it.badge && badge > 0 ? `<span class="badge">${badge}</span>` : ''}
          </div>`).join('')}
      </div>`).join('')}`;
  sb.querySelectorAll('.sb-item').forEach((el) => {
    el.onclick = () => { App.go(el.dataset.route); };
  });

  const bn = document.getElementById('bottomnav');
  bn.innerHTML = BOTTOM.map((it) => `
    <div class="bn-item ${it.center ? 'bn-center' : ''} ${navActive(it.route) ? 'active' : ''}" data-route="${it.route}" ${it.center ? 'title="首页"' : ''}>
      <span class="bn-ico">${it.ico}</span>${it.center ? '' : it.label}
    </div>`).join('');
  bn.querySelectorAll('.bn-item').forEach((el) => {
    el.onclick = () => { App.go(el.dataset.route); };
  });
}

/* ---------------- 路由渲染 ---------------- */
let currentCleanup = null;

function parseRoute() {
  const h = location.hash || '#/home';
  const [path, query = ''] = h.split('?');
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      const params = { ...(r.params || {}) };
      query.split('&').forEach((kv) => {
        const i = kv.indexOf('=');
        if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
      // 从正则捕获组补充 :id 参数
      if (m[1]) {
        if (r.key === 'animalDetail' || r.key === 'eggDetail' || r.key === 'cageEditor') params.id = decodeURIComponent(m[1]);
        if (r.key === 'animalForm') params.id = decodeURIComponent(m[1]);
      }
      return { key: r.key, params, hash: h };
    }
  }
  return null;
}

async function renderRoute(isRefresh = false) {
  const view = document.getElementById('view');
  const r = parseRoute();
  if (!r) { location.hash = '#/home'; return; }
  const mod = Pages[r.key];
  if (!mod) { view.innerHTML = '<div class="empty-tip">页面不存在</div>'; return; }
  document.title = (mod.title || '养个爬') + ' · 养个爬';
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch (e) { /* ignore */ } }
  currentCleanup = null;
  if (!isRefresh) window.scrollTo(0, 0);
  try {
    const cleanup = await mod.render(view, r.params);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><h3>页面加载失败</h3><div class="hint">${(err && err.message) || err}</div></div>`;
  }
  renderNav();
  syncBackBtn(location.hash || '#/home');
}

/* ---------------- PWA：Service Worker + 安装到主屏 ---------------- */
// 仅 http(s) 环境、非 Capacitor 原生、非自动化测试时注册；file:// 直开或原生 App 内不注册
function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (window.Capacitor) return;
  if (navigator.webdriver) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 本地环境注册失败可忽略 */ });
  });
}

// 捕获浏览器「安装应用」事件（Android Chrome），供设置页「安装」按钮使用
window.__rbInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__rbInstall = e;
});
window.addEventListener('appinstalled', () => {
  window.__rbInstall = null;
  toast('已安装到设备，可像 App 一样从桌面启动');
});

/* ---------------- 启动 ---------------- */
// 同步状态栏/导航栏图标明暗到原生层（edge-to-edge 下顶部栏会延伸到状态栏后方）
function syncSystemBars() {
  const dark = document.documentElement.dataset.theme === 'dark';
  if (window.RBNative && typeof window.RBNative.setStatusBarStyle === 'function') {
    window.RBNative.setStatusBarStyle(!dark); // 暗色主题 → 浅色图标
  }
}

// Android 原生返回键 / 全面屏手势返回入口：关图片放大 → 关弹窗 → 历史返回 → 回首页 → 退出
// v3.2：新增「图片/SVG 全屏查看器」优先级 —— 所有页面点缩略图放大后，
//        返回键应先关闭放大层，而不是直接后退路由或退出 App。
window.__rbHasOverlay = () => {
  if (document.querySelector('.zoom-viewer.open')) return 'yes';
  if (document.querySelector('.modal-mask')) return 'yes';
  return 'no';
};
window.__rbBack = () => {
  // 1) 图片 / SVG 全屏查看器（全局灯箱）
  const zoom = document.querySelector('.zoom-viewer.open');
  if (zoom) {
    closeZoomViewer();
    return 'handled';
  }
  // 2) 弹窗（取最上层那一个 —— 弹窗可堆叠，如食物库上再开编辑框）
  const masks = document.querySelectorAll('.modal-mask');
  if (masks.length) {
    const mask = masks[masks.length - 1];
    const btn = mask.querySelector('.m-close');
    if (btn) { btn.click(); return 'handled'; }
  }
  // 3) 历史返回 → 4) 回首页 → 5) 退出
  if (window.history.length > 1) { window.history.back(); return 'handled'; }
  const h = location.hash || '#/home';
  if (h !== '#/home') { location.hash = '#/home'; return 'handled'; }
  return 'exit';
};

async function boot() {
  applyTheme();
  syncSystemBars();
  installPicker(); // 自定义下拉选择器：增强所有 <select>（含动态渲染）
  installLightbox(); // 全局图片点击全屏查看（缩放 / 拖拽）
  syncBackBtn(location.hash || '#/home');
  if (window.RBNative && typeof window.RBNative.ready === 'function') {
    window.RBNative.ready(); // 通知原生层重新注入安全区 insets（避免加载时序丢失）
  }
  document.getElementById('btn-theme').onclick = () => { toggleTheme(); syncSystemBars(); renderRoute(true); };
  try {
    await initStore();
    await refreshAutoTodos();
  } catch (err) {
    console.error(err);
    document.getElementById('view').innerHTML =
      `<div class="card"><h3>本地数据库初始化失败</h3><div class="hint">${err.message || err}<br>请确认浏览器未禁用 IndexedDB（无痕模式可能不可用）。</div></div>`;
    return;
  }
  if (!location.hash) history.replaceState(null, '', '#/home'); // 不新增历史记录，保证首页按返回可直接退出
  window.addEventListener('hashchange', () => renderRoute(false));
  renderRoute(false);
  registerAppServiceWorker();
  // v3.3：版本更新说明弹窗（同一版本仅弹一次）
  try { await maybeShowUpdateNotice(); } catch (e) { console.error(e); }
}

boot();
