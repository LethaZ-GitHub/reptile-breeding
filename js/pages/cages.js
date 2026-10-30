// pages/cages.js —— 爬柜方案管理（新建：名称/可放爬箱数/上次清理时间；清理周期设置）
'use strict';

import { App } from '../app.js';
import { esc, toast, promptDialog, confirmDialog, todayStr, runModal } from '../util.js';
import { pageHead, emptyTip } from '../ui.js';
import { listPlans, createPlan, renamePlan, removePlan, updatePlan, listCages, createCage, animalsInCage, cleanDueOf, refreshAutoTodos } from '../store.js';
import { CLEAN_CYCLES } from '../schema.js';

export default {
  title: '爬柜方案',
  render(el) {
    el.innerHTML = `${pageHead('爬柜方案', '多套爬柜布局，快速切换', `<button class="btn" id="btn-new">＋ 新建方案</button>`)}
      <div class="list" id="plan-list"></div>`;

    function renderList() {
      const plans = listPlans();
      const box = el.querySelector('#plan-list');
      if (!plans.length) {
        box.innerHTML = emptyTip('🏡', '还没有爬柜方案，点击「新建方案」开始规划你的爬柜');
      } else {
        box.innerHTML = plans.map((p) => {
          const cages = listCages(p.id);
          const animals = cages.reduce((s, c) => s + animalsInCage(c.id).length, 0);
          const overdue = cages.filter((c) => cleanDueOf(c).left < 0).length;
          const cycle = CLEAN_CYCLES[p.cleanCycle] || CLEAN_CYCLES.month;
          const cap = p.capacity || 4;
          return `<div class="card" data-id="${p.id}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
              <div style="min-width:0">
                <div style="font-weight:700;font-size:16px">${esc(p.name)}</div>
                <div style="color:var(--muted);font-size:12.5px;margin-top:4px">
                  ${cages.length}/${cap} 个爬箱 · ${animals} 只个体入住
                  ${overdue ? ` · <span class="countdown overdue">${overdue} 箱待清理</span>` : ''}
                  <br>清理周期：${cycle.label} · 上次清理 ${esc(p.lastCleanAt || '—')}
                </div>
              </div>
              <div class="btn-row">
                <button class="btn sm" data-act="open">进入爬柜</button>
                <button class="btn ghost sm" data-act="settings">⚙️ 设置</button>
                <button class="btn ghost sm" data-act="rename">重命名</button>
                <button class="btn ghost sm" data-act="del" style="color:var(--danger)">删除</button>
              </div>
            </div>
          </div>`;
        }).join('');
      }
      box.querySelectorAll('.card').forEach((card) => {
        const id = card.dataset.id;
        const plan = () => listPlans().find((p) => p.id === id);
        card.querySelector('[data-act="open"]').onclick = () => App.go('#/cage/' + id);
        card.querySelector('[data-act="rename"]').onclick = async () => {
          const name = await promptDialog('重命名方案', '新的方案名称', { defaultValue: plan().name });
          if (!name) return;
          await renamePlan(id, name);
          renderList();
        };
        card.querySelector('[data-act="settings"]').onclick = () => planSettings(plan());
        card.querySelector('[data-act="del"]').onclick = async () => {
          const cages = listCages(id).length;
          const ok = await confirmDialog('删除爬柜方案',
            `将删除「${plan().name}」及其 ${cages} 个爬箱布局。\n箱内个体会解除爬箱绑定（个体本身不会被删除）。此操作不可恢复！`,
            { okText: '确认删除', danger: true });
          if (!ok) return;
          await removePlan(id);
          toast('已删除', 'ok');
          renderList();
        };
      });
    }

    /* 爬柜设置：清理周期 + 上次清理时间 + 可放爬箱数（数量增加时自动补齐爬箱） */
    async function planSettings(p) {
      if (!p) return;
      const cages = listCages(p.id);
      const res = await runModal({
        title: `爬柜设置 · ${p.name}`,
        bodyHtml: `
          <div class="field"><label>可放爬箱数<span class="req">*</span></label><input type="number" id="st-cap" value="${p.capacity || 4}" min="1" max="60">
            <div class="hint">当前已有 ${cages.length} 个爬箱；数量增加时将自动补齐新爬箱，减少时不会删除已有爬箱</div></div>
          <div class="field"><label>清理周期</label><select id="st-cycle">
            ${Object.entries(CLEAN_CYCLES).map(([v, c]) => `<option value="${v}" ${p.cleanCycle === v ? 'selected' : ''}>${c.label}（每 ${c.days} 天）</option>`).join('')}
          </select></div>
          <div class="field"><label>上次清理时间</label><input type="date" id="st-lastclean" value="${(p.lastCleanAt || todayStr()).slice(0, 10)}"></div>
          <div class="hint">按「上次清理时间 + 清理周期」计算下次清理日期，到期前 7 天自动在首页生成清理待办。</div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '保存', value: 'ok' }],
      });
      if (!res) return;
      const cap = Math.min(60, Math.max(1, +((document.getElementById('st-cap') || {}).value) || 4));
      const cycle = (document.getElementById('st-cycle') || {}).value || 'month';
      const lastCleanAt = (document.getElementById('st-lastclean') || {}).value || todayStr();
      await updatePlan(p.id, { capacity: cap, cleanCycle: cycle, lastCleanAt });
      // 数量增加 → 按新数量自动补齐爬箱
      const nowCount = listCages(p.id).length;
      let created = 0;
      for (let i = nowCount; i < cap; i++) {
        await createCage(p.id, {});
        created += 1;
      }
      await refreshAutoTodos();
      toast(created > 0 ? `已保存，自动新建 ${created} 个爬箱` : (cap < nowCount ? `已保存（已有 ${nowCount} 个爬箱，未自动删除）` : '爬柜设置已保存'), 'ok');
      renderList();
    }

    el.querySelector('#btn-new').onclick = async () => {
      const res = await runModal({
        title: '新建爬柜方案',
        bodyHtml: `
          <div class="field"><label>方案名称<span class="req">*</span></label><input type="text" id="pl-name" placeholder="例如：主房爬柜 / 工作室爬柜"></div>
          <div class="field"><label>可放爬箱数<span class="req">*</span></label><input type="number" id="pl-cap" value="4" min="1" max="60"></div>
          <div class="field"><label>上次清理时间</label><input type="date" id="pl-lastclean" value="${todayStr()}">
            <div class="hint">与「清理周期」共同计算下次清理日期，到期自动生成待办</div></div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '创建', value: 'ok' }],
      });
      if (!res) return;
      const name = (document.getElementById('pl-name').value || '').trim();
      if (!name) { toast('请输入方案名称', 'warn'); return; }
      const cap = Math.min(60, Math.max(1, +document.getElementById('pl-cap').value || 4));
      const lastCleanAt = (document.getElementById('pl-lastclean') || {}).value || todayStr();
      const p = await createPlan(name, { capacity: cap, lastCleanAt });
      toast('方案已创建', 'ok');
      App.go('#/cage/' + p.id);
    };

    renderList();
  },
};
