// pages/bills.js —— 记账收支列表
'use strict';

import { App } from '../app.js';
import { esc, toast, fmtMoney, monthKey, monthLabel, prevMonth, nextMonth, runModal, confirmDialog, todayStr } from '../util.js';
import { pageHead, emptyTip } from '../ui.js';
import { listBills, createBill, updateBill, removeBill, BILL_CATS, listAnimals, animalName, reportOf } from '../store.js';

const PAGE = 15;

export default {
  title: '记账',
  render(el) {
    const state = { month: monthKey(), type: '', page: 1 };

    el.innerHTML = `
      ${pageHead('记账报表', '支出 / 收入流水；个体购入与售出自动生成账单', `
        <button class="btn" id="btn-add">＋ 记一笔</button>
        <button class="btn ghost" id="btn-report">📊 报表</button>`)}
      <div class="card stat-hero" id="bill-hero"></div>
      <div class="metrics metrics-2" id="bill-metrics"></div>
      <div class="card">
        <div class="card-head">
          <h3>账单明细</h3>
          <div class="card-head-act">
            <button class="btn ghost sm" id="m-prev">‹ 上月</button>
            <b id="m-label">${monthLabel(state.month)}</b>
            <button class="btn ghost sm" id="m-next">下月 ›</button>
          </div>
        </div>
        <div class="seg" id="f-type">${[
          { v: '', l: '全部' }, { v: 'expense', l: '支出' }, { v: 'income', l: '收入' },
        ].map((x) => `<div class="seg-item ${x.v === '' ? 'active' : ''}" data-type="${x.v}">${x.l}</div>`).join('')}</div>
        <div id="bill-list"></div>
        <div id="pager"></div>
      </div>`;

    el.querySelector('#btn-report').onclick = () => App.go('#/reports');
    el.querySelector('#btn-add').onclick = () => billModal(null, render);
    el.querySelector('#m-prev').onclick = () => { state.month = prevMonth(state.month); state.page = 1; renderHead(); render(); };
    el.querySelector('#m-next').onclick = () => { state.month = nextMonth(state.month); state.page = 1; renderHead(); render(); };
    el.querySelector('#f-type').addEventListener('click', (e) => {
      const item = e.target.closest('.seg-item');
      if (!item) return;
      el.querySelectorAll('#f-type .seg-item').forEach((x) => x.classList.remove('active'));
      item.classList.add('active');
      state.type = item.dataset.type; state.page = 1;
      render();
    });

    function renderHead() {
      el.querySelector('#m-label').textContent = monthLabel(state.month);
      el.querySelector('#m-prev').disabled = false;
    }

    function render() {
      const rows = listBills({ month: state.month, type: state.type });
      const r = reportOf(state.month);
      const box = el.querySelector('#bill-list');

      // 顶部汇总：账本总支出（全部账本累计支出，不扣收入/盈利）
      const allExp = listBills({ type: 'expense' });
      const totalExpense = allExp.reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const curMonth = monthKey();
      const isCur = state.month === curMonth;
      const mLabel = isCur ? '本月' : (+state.month.split('-')[1]) + '月';
      el.querySelector('#bill-hero').innerHTML = `
        <div class="sh-label">💸 账本总支出</div>
        <div class="sh-value">¥${fmtMoney(totalExpense)}</div>
        <div class="sh-sub">全部账本支出累计 · 共 ${allExp.length} 笔 · 不扣除收入与盈利</div>`;
      el.querySelector('#bill-metrics').innerHTML = `
        <div class="metric expense"><div class="m-label">${mLabel}支出</div><div class="m-value">¥${fmtMoney(r.expTotal)}</div></div>
        <div class="metric income"><div class="m-label">${mLabel}收入</div><div class="m-value">¥${fmtMoney(r.incTotal)}</div></div>`;

      if (!rows.length) {
        box.innerHTML = emptyTip('🧾', '本月暂无账单');
      } else {
        const start = (state.page - 1) * PAGE;
        const items = rows.slice(start, start + PAGE).map((b) => `<div class="bill-item" data-id="${b.id}">
          <div class="bi-top">
            <span class="bi-cat">${esc(b.category)}${b.auto ? ' <span class="st st-unknown" title="由个体档案自动生成">自动</span>' : ''}</span>
            <span class="bi-amt" style="color:${b.type === 'income' ? 'var(--income)' : 'var(--expense)'}">${b.type === 'income' ? '+' : '-'}¥${fmtMoney(b.amount)}</span>
          </div>
          <div class="bi-note">${b.relatedAnimalId ? `<a href="#/animal/${b.relatedAnimalId}">${esc(animalName(b.relatedAnimalId))}</a> ` : ''}${esc(b.note || '')}</div>
          <div class="bi-foot">
            <span class="bi-date">${esc(b.date)}</span>
            <span class="bi-acts"><button class="btn ghost sm" data-edit="${b.id}">编辑</button><button class="btn ghost sm" data-del="${b.id}" style="color:var(--danger)">删</button></span>
          </div>
        </div>`).join('');
        box.innerHTML = `<div class="bill-list">${items}</div>`;
        box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => billModal(rows.find((x) => x.id === b.dataset.edit), render); });
        box.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const ok = await confirmDialog('删除账单', '确定删除这条账单吗？', { okText: '删除', danger: true });
            if (!ok) return;
            await removeBill(b.dataset.del);
            toast('已删除');
            render();
          };
        });
      }
      // 分页
      const pager = el.querySelector('#pager');
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      pager.innerHTML = rows.length > PAGE
        ? `<div class="pager"><button ${state.page <= 1 ? 'disabled' : ''} data-p="prev">‹ 上一页</button><span>第 ${state.page}/${pages} 页 · 共 ${rows.length} 条</span><button ${state.page >= pages ? 'disabled' : ''} data-p="next">下一页 ›</button></div>`
        : '';
      pager.querySelectorAll('.pager button').forEach((b) => {
        b.onclick = () => { state.page += b.dataset.p === 'prev' ? -1 : 1; render(); };
      });
    }

    render();
  },
};

async function billModal(bill, done) {
  const editing = !!bill;
  const animals = listAnimals();
  const res = await runModal({
    title: editing ? '编辑账单' : '记一笔',
    bodyHtml: `
      <div class="field"><label>类型</label><select id="b-type">
        <option value="expense" ${editing && bill.type === 'income' ? '' : 'selected'}>支出</option>
        <option value="income" ${editing && bill.type === 'income' ? 'selected' : ''}>收入</option>
      </select></div>
      <div class="field"><label>分类</label><select id="b-cat">${BILL_CATS.expense.concat(BILL_CATS.income).map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>金额（元）<span class="req">*</span></label><input type="number" id="b-amount" min="0" step="0.01" value="${editing ? bill.amount : ''}"></div>
      <div class="field"><label>日期</label><input type="date" id="b-date" value="${editing ? bill.date : todayStr()}"></div>
      <div class="field"><label>关联个体</label><select id="b-animal"><option value="">不关联</option>${animals.map((a) => `<option value="${a.id}" ${editing && bill.relatedAnimalId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>备注</label><input type="text" id="b-note" value="${editing ? esc(bill.note || '') : ''}"></div>
      <div class="hint">个体购入价格 / 售出金额会由档案自动生成账单（标记「自动」），手动删除后不会再次自动生成。</div>`,
    buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
    mount: (mask) => {
      const cat = mask.querySelector('#b-cat');
      if (editing) cat.value = bill.category;
      const syncCats = () => {
        const t = mask.querySelector('#b-type').value;
        const list = BILL_CATS[t];
        cat.innerHTML = list.map((c) => `<option>${c}</option>`).join('');
      };
      mask.querySelector('#b-type').onchange = syncCats;
      syncCats();
      if (editing) cat.value = bill.category;
    },
  });
  if (!res) return;
  const v = (id) => (document.getElementById(id) || {}).value || '';
  const amount = Number(v('b-amount'));
  if (!amount || amount <= 0) { toast('请输入有效金额', 'warn'); return; }
  const data = {
    type: v('b-type'), category: v('b-cat'), amount,
    date: v('b-date') || todayStr(),
    relatedAnimalId: v('b-animal') || null,
    note: v('b-note'),
  };
  if (editing) await updateBill(bill.id, data);
  else await createBill(data);
  toast(editing ? '已保存' : '已记账', 'ok');
  if (done) done();
}
