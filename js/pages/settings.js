// pages/settings.js —— 全局设置（单位 / 主题）
// v2.6：移除「报表统计」「测试数据」两个卡片；体重单位切换完善默认实现（默认克）
'use strict';

import { esc, toast } from '../util.js';
import { pageHead } from '../ui.js';
import { App } from '../app.js';
import { unitWeight, unitLength, getSetting, setSetting, toggleTheme } from '../settings.js';
import { S } from '../store.js';
import { TABLES } from '../schema.js';

const TABLE_LABELS = { species: '物种', gene: '基因', tag: '标签', animal: '个体', animal_photo: '照片', animal_log: '日志', egg: '蛋', pairing: '配对', cage_plan: '爬柜方案', cage: '爬箱', todo: '待办', bill: '账单' };
const UNIT_LABEL = { g: '克（g）', oz: '盎司（oz）' };

export default {
  title: '设置',
  render(el) {
    // v2.7：归一值必须在 render 内现算——模块级常量在 App.refresh() 时不会重算，
    //      切换单位后 active 高亮会停在旧值（按钮颜色不变化）
    const wu = getSetting('weightUnit') === 'oz' ? 'oz' : 'g';
    const lu = getSetting('lengthUnit') === 'inch' ? 'inch' : 'cm';
    const th = getSetting('theme') === 'dark' ? 'dark' : 'light';
    el.innerHTML = `
      ${pageHead('设置', '单位与主题为设备本地偏好，不随备份迁移')}
      <div class="card">
        <h3>铲屎官</h3>
        <div class="set-row">
          <div><div class="sr-label">铲屎官名</div><div class="sr-sub">新建个体时自动填入，可逐个修改；导出分享包时可选择是否保留</div></div>
          <div class="keeper-row">
            <input type="text" id="inp-keeper" value="${esc(getSetting('keeperName') || '')}" placeholder="例如：小明">
            <button class="btn" id="btn-keeper-save">保存</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>全局单位</h3>
        <div class="set-row">
          <div><div class="sr-label">体重单位</div><div class="sr-sub">表单、图表、列表自动跟随；默认克，存储口径统一为 g</div></div>
          <div class="seg-mini seg-unit" id="u-weight">
            <button data-v="g" class="${wu === 'g' ? 'active' : ''}"><span class="su-cn">克</span><span class="su-en">g</span></button>
            <button data-v="oz" class="${wu === 'oz' ? 'active' : ''}"><span class="su-cn">盎司</span><span class="su-en">oz</span></button>
          </div>
        </div>
        <div class="set-row">
          <div><div class="sr-label">体长单位</div><div class="sr-sub">表单、图表、列表自动跟随；默认厘米，存储口径统一为 cm</div></div>
          <div class="seg-mini seg-unit" id="u-length">
            <button data-v="cm" class="${lu === 'cm' ? 'active' : ''}"><span class="su-cn">厘米</span><span class="su-en">cm</span></button>
            <button data-v="inch" class="${lu === 'inch' ? 'active' : ''}"><span class="su-cn">英寸</span><span class="su-en">inch</span></button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>外观</h3>
        <div class="set-row">
          <div><div class="sr-label">主题模式</div><div class="sr-sub">浅色 / 深色，本地保存</div></div>
          <div class="seg-mini" id="u-theme">
            <button data-v="light" class="${th === 'light' ? 'active' : ''}">☀️ 浅色</button>
            <button data-v="dark" class="${th === 'dark' ? 'active' : ''}">🌙 深色</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>本机数据</h3>
        <div class="legend" style="margin:0">
          ${TABLES.map((t) => `<span class="lg"><span class="tag-dot" style="background:var(--brand)"></span>${TABLE_LABELS[t] || t} <b>${(S[t] || []).length}</b></span>`).join('')}
        </div>
        <div class="hint" style="margin-top:10px">当前单位：体重 ${esc(unitWeight())} · 体长 ${esc(unitLength())} · 存储口径统一为 g / cm，切换单位仅影响显示。</div>
      </div>`;

    el.querySelector('#u-weight').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const v = b.dataset.v === 'oz' ? 'oz' : 'g';
      setSetting('weightUnit', v);
      toast('体重单位已切换为 ' + UNIT_LABEL[v]);
      App.refresh();
    });
    el.querySelector('#u-length').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const v = b.dataset.v === 'inch' ? 'inch' : 'cm';
      setSetting('lengthUnit', v);
      toast('体长单位已切换为 ' + (v === 'inch' ? '英寸（inch）' : '厘米（cm）'));
      App.refresh();
    });
    el.querySelector('#u-theme').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.v !== getSetting('theme')) toggleTheme();
      App.refresh();
    });

    /* 铲屎官名 */
    el.querySelector('#btn-keeper-save').onclick = () => {
      const v = el.querySelector('#inp-keeper').value.trim();
      setSetting('keeperName', v);
      toast(v ? `铲屎官名已保存：${v}` : '铲屎官名已清除', 'ok');
    };
  },
};
