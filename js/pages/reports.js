// pages/reports.js —— 月度记账报表
'use strict';

import { esc, toast, fmtMoney, monthKey, monthLabel, prevMonth, nextMonth } from '../util.js';
import { pageHead, emptyTip } from '../ui.js';
import { reportOf, syncSoldIncomeFlag } from '../store.js';
import { donutChart } from '../charts.js';
import { getSetting, setSetting } from '../settings.js';

const CAT_COLORS = ['#2e9e6b', '#5b8fc9', '#e8912d', '#c95f6e', '#9a6fc9', '#6bb5a8', '#8a8f4b', '#d0533a'];

export default {
  title: '报表',
  render(el) {
    const state = { month: monthKey() };
    el.innerHTML = `
      ${pageHead('月度报表', '月度分类统计 · 单位：元')}
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <button class="btn ghost sm" id="m-prev">‹ 上月</button>
          <b id="m-label">${monthLabel(state.month)}</b>
          <button class="btn ghost sm" id="m-next">下月 ›</button>
        </div>
        <div class="metrics" id="m-metrics"></div>
        <div class="set-row">
          <div><div class="sr-label">已售出个体的售出收入纳入总收入统计</div>
            <div class="sr-sub">关闭后，售出收入不计入报表收入与净额</div></div>
          <label class="switch"><input type="checkbox" id="sw-sold" ${getSetting('countSoldIncome') ? 'checked' : ''}><span class="sl"></span></label>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>支出分类</h3></div>
        <div id="exp-box"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>收入分类</h3></div>
        <div id="inc-box"></div>
      </div>`;

    function render() {
      const r = reportOf(state.month);
      el.querySelector('#m-label').textContent = monthLabel(state.month);
      el.querySelector('#m-metrics').innerHTML = `
        <div class="metric expense"><div class="m-label">本月支出</div><div class="m-value">¥${fmtMoney(r.expTotal)}</div></div>
        <div class="metric income"><div class="m-label">本月收入</div><div class="m-value">¥${fmtMoney(r.incTotal)}</div></div>
        <div class="metric accent"><div class="m-label">本月净额</div><div class="m-value">¥${fmtMoney(r.net)}</div></div>
        <div class="metric"><div class="m-label">其中售出收入</div><div class="m-value" style="font-size:19px">¥${fmtMoney(r.incSold)}</div></div>`;
      donut(el.querySelector('#exp-box'), r.expense, '本月无支出记录');
      donut(el.querySelector('#inc-box'), r.income, '本月无收入记录');
    }
    function donut(box, map, emptyText) {
      const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
      if (!entries.length) { box.innerHTML = emptyTip('📊', emptyText); return; }
      const data = entries.map(([label, value], i) => ({ label, value, color: CAT_COLORS[i % CAT_COLORS.length] }));
      box.innerHTML = `
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          <div class="chart-wrap" style="max-width:210px;flex-shrink:0">${donutChart({ data, size: 200 })}</div>
          <div class="legend" style="flex-direction:column;gap:7px;flex:1;min-width:150px">
            ${data.map((d) => `<span class="lg"><span class="tag-dot" style="background:${d.color}"></span>${esc(d.label)} <b>¥${fmtMoney(d.value)}</b>（${Math.round(d.value / data.reduce((s, x) => s + x.value, 0) * 100)}%）</span>`).join('')}
          </div>
        </div>`;
    }

    el.querySelector('#m-prev').onclick = () => { state.month = prevMonth(state.month); render(); };
    el.querySelector('#m-next').onclick = () => { state.month = nextMonth(state.month); render(); };
    el.querySelector('#sw-sold').onchange = async (e) => {
      const on = e.target.checked;
      setSetting('countSoldIncome', on);
      await syncSoldIncomeFlag(on);
      toast(on ? '售出收入已纳入统计' : '售出收入已排除出统计', 'ok');
      render();
    };
    render();
  },
};
