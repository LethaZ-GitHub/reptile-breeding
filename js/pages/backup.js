// pages/backup.js —— 备份与恢复（全量 / 部分 · JSON / Excel · 原子事务导入 · 合并导入）
// v2.2：导出可选格式（JSON / Excel / 均导出）；导入先选全量或部分，部分导入新增 Excel 支持
'use strict';

import { esc, toast, todayStr, confirmDialog, readFileAsText, download, nowStr, runModal } from '../util.js';
import { pageHead } from '../ui.js';
import {
  buildBackup, validateBackup, importBackup, localLatestTime, factoryReset,
  backupToSheets, backupFromSheets,
  reload, listAnimals, listEggs, listLogs, S,
} from '../store.js';
import { xlsxBlob, readXlsxFile } from '../xlsx.js';
import { TABLES } from '../schema.js';
import { getMeta } from '../db.js';
import { App } from '../app.js';

const TABLE_LABELS = {
  species: '物种', gene: '基因', tag: '标签', animal: '个体', animal_photo: '照片',
  animal_log: '日志', egg: '蛋', pairing: '配对', cage_plan: '爬柜方案', cage: '爬箱',
  todo: '待办', bill: '账单', food: '食物',
};
const FMT_LABELS = { json: 'JSON', xlsx: 'Excel', both: '均导出' };

export default {
  title: '备份与恢复',
  async render(el) {
    const lastImport = await getMeta('lastImportAt');
    el.innerHTML = `
      ${pageHead('备份与恢复', '数据仅存本机；跨设备迁移靠备份包', `<button class="btn" id="btn-export">💾 备份</button>`)}
      <div class="card">
        <h3>备份</h3>
        <div class="hint" style="line-height:1.9;margin-bottom:12px">
          点击「备份」后可选择：<b>全量备份</b>（全部 ${TABLES.length} 张表，适合整机迁移）或<b>部分备份</b>（勾选需要的数据表，可多选）。<br>
          导出格式三选一：<b>JSON</b>（备份包，全量/部分均可导入）、<b>Excel</b>（每张数据表一个工作表，便于查看与部分导入）、<b>均导出</b>（两个文件都生成）。<br>
          最近导入时间：${esc(lastImport || '从未导入')}
        </div>
        <div class="metrics" id="counts"></div>
      </div>
      <div class="card">
        <h3>导入备份</h3>
        <div class="hint" style="line-height:1.9;margin-bottom:12px">
          点击「选择备份文件导入」后先选<b>全量</b>或<b>部分</b>：<br>
          <b>全量导入</b>：事务原子模式整体替换（全部写入成功或整体回滚，不会半导入），支持 JSON 与 Excel 全量包；<br>
          <b>部分导入</b>：按 ID 覆盖合并，只影响包内数据表，其他表不受影响，支持 JSON 与 Excel（v2.2 新增）。<br>
          导入前需二次确认：<b>数据被覆盖后无法恢复</b>，建议先备份当前数据。
        </div>
        <input type="file" id="file-import" accept=".json,.xlsx,application/json" style="display:none">
        <button class="btn warn" id="btn-import">📂 选择备份文件导入</button>
      </div>
      <div class="card">
        <h3 style="color:var(--danger)">危险区</h3>
        <div class="hint" style="margin-bottom:10px">恢复出厂将清空全部数据并重建内置物种 / 基因库，不可恢复。建议先导出备份。</div>
        <button class="btn danger" id="btn-reset">🔥 恢复出厂设置</button>
      </div>`;

    el.querySelector('#counts').innerHTML = TABLES.map((t) =>
      `<div class="metric"><div class="m-label">${TABLE_LABELS[t] || t}</div><div class="m-value" style="font-size:20px">${(S[t] || []).length}</div></div>`).join('');

    /* ---------- 备份：全量 / 部分（多选表） × 格式（JSON / Excel / 均导出） ---------- */
    el.querySelector('#btn-export').onclick = async () => {
      const choice = await runModal({
        title: '备份数据',
        bodyHtml: `
          <div class="seg" id="bk-mode" style="margin-bottom:12px">
            <div class="seg-item active" data-v="full">全量备份</div>
            <div class="seg-item" data-v="partial">部分备份</div>
          </div>
          <div id="bk-full" class="hint" style="line-height:1.8">
            备份全部 ${TABLES.length} 张表：${TABLES.map((t) => TABLE_LABELS[t] || t).join(' / ')}。<br>适合整机迁移与完整归档。
          </div>
          <div id="bk-partial" style="display:none">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
              <div class="hint" style="margin:0">勾选需要备份的数据表（可多选，未勾选的表不会进入备份包）：</div>
              <button class="btn ghost sm" id="bk-selall">☑ 全选</button>
            </div>
            <div class="pick-list" style="max-height:40vh" id="bk-tables">
              ${TABLES.map((t) => `
                <label class="pick-row" data-id="${t}">
                  <input type="checkbox" value="${t}" ${t === 'animal' ? 'checked' : ''}>
                  <span class="pr-name">${TABLE_LABELS[t] || t}</span>
                  <span class="pr-sub">${(S[t] || []).length} 条</span>
                </label>`).join('')}
            </div>
          </div>
          <div class="seg" id="bk-fmt" style="margin:12px 0 8px">
            <div class="seg-item active" data-v="json">JSON</div>
            <div class="seg-item" data-v="xlsx">Excel</div>
            <div class="seg-item" data-v="both">均导出</div>
          </div>
          <div class="hint" id="bk-fmt-hint" style="line-height:1.7"></div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '导出备份', value: 'ok' }],
        mount: (mask, close) => {
          let mode = 'full';
          let fmt = 'json';
          const fmtHint = mask.querySelector('#bk-fmt-hint');
          const renderFmtHint = () => {
            fmtHint.innerHTML = fmt === 'json'
              ? '导出 .json 备份包：全量 / 部分均可导入，信息最完整（含照片数据）。'
              : (fmt === 'xlsx'
                ? '导出 .xlsx 表格：每张数据表一个工作表，可用 Excel / WPS 直接查看；照片等超长内容会被省略，恢复请用 JSON。'
                : '同时导出 .json 与 .xlsx 两个文件：JSON 用于完整恢复，Excel 用于查看。');
          };
          renderFmtHint();
          // 全选 / 取消全选（数据表多选）
          const selAllBtn = mask.querySelector('#bk-selall');
          if (selAllBtn) selAllBtn.onclick = () => {
            const boxes = [...mask.querySelectorAll('#bk-tables input[type="checkbox"]')];
            const allChecked = boxes.length > 0 && boxes.every((c) => c.checked);
            boxes.forEach((c) => { c.checked = !allChecked; });
            selAllBtn.textContent = allChecked ? '☑ 全选' : '☑ 取消全选';
          };
          mask.querySelectorAll('#bk-mode .seg-item').forEach((it) => {
            it.onclick = () => {
              mask.querySelectorAll('#bk-mode .seg-item').forEach((x) => x.classList.remove('active'));
              it.classList.add('active');
              mode = it.dataset.v;
              mask.querySelector('#bk-full').style.display = mode === 'full' ? '' : 'none';
              mask.querySelector('#bk-partial').style.display = mode === 'partial' ? '' : 'none';
            };
          });
          mask.querySelectorAll('#bk-fmt .seg-item').forEach((it) => {
            it.onclick = () => {
              mask.querySelectorAll('#bk-fmt .seg-item').forEach((x) => x.classList.remove('active'));
              it.classList.add('active');
              fmt = it.dataset.v;
              renderFmtHint();
            };
          });
          // 重绑底部按钮：取消 close(null)，导出带回所选表与格式
          const btns = mask.querySelector('.m-foot').querySelectorAll('button');
          btns[0].onclick = () => close(null);
          btns[1].onclick = () => {
            if (mode === 'partial') {
              const picked = [...mask.querySelectorAll('#bk-tables input:checked')].map((c) => c.value);
              if (!picked.length) { toast('请至少勾选一张数据表', 'warn'); return; }
              close({ mode: 'partial', tables: picked, fmt });
            } else {
              close({ mode: 'full', tables: null, fmt });
            }
          };
        },
      });
      if (!choice) return;
      const pkg = buildBackup(choice.mode === 'partial' ? { tables: choice.tables } : {});
      const label = choice.mode === 'partial' ? '部分' : '全量';
      const stamp = nowStr().replace(/[-: ]/g, '').slice(0, 12);
      const n = Object.values(pkg.counts).reduce((s, v) => s + v, 0);
      const base = `养个爬${label}备份_${stamp}`;
      if (choice.fmt === 'json' || choice.fmt === 'both') {
        download(`${base}.json`, JSON.stringify(pkg));
      }
      if (choice.fmt === 'xlsx' || choice.fmt === 'both') {
        download(`${base}.xlsx`, xlsxBlob(backupToSheets(pkg)));
      }
      toast(`${label}备份已导出（${FMT_LABELS[choice.fmt] || choice.fmt}，${n} 条记录）`, 'ok');
    };

    /* ---------- 导入：先选全量 / 部分，再选文件 ---------- */
    let importMode = 'full';
    el.querySelector('#btn-import').onclick = async () => {
      const mode = await runModal({
        title: '选择导入方式',
        bodyHtml: `
          <div class="seg" id="im-mode" style="margin-bottom:10px">
            <div class="seg-item active" data-v="full">全量导入</div>
            <div class="seg-item" data-v="partial">部分导入</div>
          </div>
          <div class="hint" id="im-hint" style="line-height:1.8"></div>`,
        buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '选择文件', value: 'ok' }],
        mount: (mask, close) => {
          let mode = 'full';
          const hint = mask.querySelector('#im-hint');
          const render = () => {
            hint.innerHTML = mode === 'full'
              ? '整体替换本机全部数据（事务原子：全部写入成功或整体回滚）。<br>支持 .json 全量备份包与 .xlsx（Excel）全量表格包。'
              : '按 ID 覆盖合并，只影响包内数据表，其他表不受影响。<br>支持 .json 与 .xlsx（Excel，v2.2 新增）。';
          };
          render();
          mask.querySelectorAll('#im-mode .seg-item').forEach((it) => {
            it.onclick = () => {
              mask.querySelectorAll('#im-mode .seg-item').forEach((x) => x.classList.remove('active'));
              it.classList.add('active');
              mode = it.dataset.v;
              render();
            };
          });
          const btns = mask.querySelector('.m-foot').querySelectorAll('button');
          btns[0].onclick = () => close(null);
          btns[1].onclick = () => close(mode);
        },
      });
      if (!mode) return;
      importMode = mode;
      el.querySelector('#file-import').click();
    };
    el.querySelector('#file-import').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const isXlsx = /\.xlsx$/i.test(file.name) || (file.type || '').includes('sheet');
      let pkg;
      let photoSkipped = 0;
      try {
        if (isXlsx) {
          const { sheets } = await readXlsxFile(file);
          pkg = backupFromSheets(sheets);
          // Excel 单元格容量有限：照片数据超长会被截断，截断的 photo 行跳过（避免写入坏图）
          if (Array.isArray(pkg.tables.animal_photo)) {
            const before = pkg.tables.animal_photo.length;
            pkg.tables.animal_photo = pkg.tables.animal_photo.filter((r) => r && (r.full || r.thumb));
            photoSkipped = before - pkg.tables.animal_photo.length;
          }
        } else {
          pkg = JSON.parse(await readFileAsText(file));
        }
        validateBackup(pkg);
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
        return;
      }
      if (importMode === 'full' && pkg.partial) {
        toast('该文件是部分备份，请改选「部分导入」', 'warn');
        return;
      }
      const partial = !!pkg.partial;
      const total = Object.values(pkg.counts || {}).reduce((s, v) => s + (Number(v) || 0), 0);
      const ok = await confirmDialog('⚠️ 导入将覆盖数据',
        `备份包导出时间：${(pkg.exportedAt || '未知').replace('T', ' ').slice(0, 19)}\n` +
        `导入方式：${importMode === 'full' ? '全量导入（整体替换本机全部数据）' : '部分导入（按 ID 覆盖合并，仅影响包内数据表）'}\n` +
        `包含记录：约 ${total} 条\n\n` +
        `导入后本机相关数据将被备份内容覆盖，且无法恢复！\n建议先「备份」当前数据。确定继续导入？`,
        { okText: '我已了解，导入', danger: true });
      if (!ok) return;
      try {
        await importBackup(pkg);
        let msg = importMode === 'full' ? '导入成功，全部数据已原子写入' : '部分备份已合并导入';
        if (photoSkipped > 0) msg += `（${photoSkipped} 张照片因 Excel 容量限制未包含，请用 JSON 备份恢复照片）`;
        toast(msg, 'ok');
        App.refresh();
      } catch (err) {
        toast('导入失败，已回滚（本机数据未损坏）：' + err.message, 'err');
      }
    };

    el.querySelector('#btn-reset').onclick = async () => {
      const ok1 = await confirmDialog('恢复出厂设置', '将清空全部业务数据（个体/日志/蛋/爬柜/待办/账单），并重建内置库。此操作不可恢复！', { okText: '我已了解，继续', danger: true });
      if (!ok1) return;
      const ok2 = await confirmDialog('再次确认', '真的要清空全部数据吗？建议先「备份」当前数据。', { okText: '确认清空', danger: true });
      if (!ok2) return;
      await factoryReset();
      toast('已恢复出厂设置', 'ok');
      App.go('#/home');
    };
  },
};
