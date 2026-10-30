// js/version.js —— 应用版本号（单一事实来源）
// v2.9 起：tools/sync-web.mjs 会用 package.json 的 version 覆写 www/js/version.js，
//          保证「设置/关于」页显示的版本与实际打包版本永远一致。
export const APP_VERSION = '1.0.0';
export const APP_BUILD = 28;
