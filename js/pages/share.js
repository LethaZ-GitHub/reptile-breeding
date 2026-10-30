// pages/share.js —— 个体分享包（精简包：档案 + 照片，不含日志/谱系）
'use strict';

import { esc, toast, runModal, readFileAsText, download, nowStr } from '../util.js';
import { pageHead, emptyTip, animalThumbHtml, sexIco } from '../ui.js';
import { buildShare, validateShare, importShare, listAnimals, speciesName } from '../store.js';
import { App } from '../app.js';

export default {
  title: '个体分享',
  render(el) {
    const state = { q: '' };
    el.innerHTML = `
      ${pageHead('个体分享', '导出精简分享包给爬友，对方导入到自己的 App / Web', '')}
      <div class="card">
        <h3>导出分享包</h3>
        <div class="hint" style="line-height:1.9;margin-bottom:12px">
          分享包仅包含：个体基础档案 + 最多 3 张照片。<b>不含饲养日志、不含谱系（父母信息）</b>。<br>
          选择下面列表中的个体进行导出，文件为 JSON，可直接微信/邮件发送。
        </div>
        <div class="search-box"><input type="text" id="share-q" placeholder="搜索要导出的个体…"></div>
        <div class="list" id="share-list"></div>
      </div>
      <div class="card">
        <h3>导入分享包</h3>
        <div class="hint" style="line-height:1.9;margin-bottom:12px">导入会作为一只新个体加入本机（自动分配新编号），物种/基因按名称自动匹配，匹配不上的字段置空。</div>
        <input type="file" id="file-import" accept=".json,application/json" style="display:none">
        <button class="btn warn" id="btn-import">📥 选择分享包文件导入</button>
      </div>`;

    function renderList() {
      const rows = listAnimals({ q: state.q });
      el.querySelector('#share-list').innerHTML = rows.length ? rows.map((a) => `
        <div class="row" data-id="${a.id}">
          ${animalThumbHtml(a)}
          <div class="row-main">
            <div class="row-title">${esc(a.name)} ${sexIco(a.sex)}</div>
            <div class="row-sub">${esc(speciesName(a.speciesId) || '')}</div>
          </div>
          <div class="row-side"><button class="btn sm" data-exp="${a.id}">导出</button></div>
        </div>`).join('') : emptyTip('🦎', '没有匹配的个体');
      el.querySelectorAll('[data-exp]').forEach((b) => {
        b.onclick = async (ev) => {
          ev.stopPropagation();
          const a = listAnimals().find((x) => x.id === b.dataset.exp);
          // 导出前选择是否保留铲屎官名（默认不保留，避免个人信息随分享包外泄）
          const choice = await runModal({
            title: '导出分享包',
            bodyHtml: `
              <div class="hint" style="margin-bottom:10px">将导出「${esc(a.name)}」的档案与照片（不含日志、谱系）。</div>
              <div class="field"><label>铲屎官名</label><select id="sh-keeper">
                <option value="0">不保留（清除后导出）</option>
                <option value="1">保留「${esc(a.keeper || '未填写')}」</option>
              </select></div>`,
            buttons: [{ text: '取消', cls: 'ghost', value: null }, { text: '导出', value: 'ok' }],
          });
          if (!choice) return;
          const keepKeeper = (document.getElementById('sh-keeper') || {}).value === '1';
          const pkg = buildShare(a.id, { keepKeeper });
          download(`爬宠分享包_${a.name}_${nowStr().replace(/[-: ]/g, '').slice(0, 8)}.json`, JSON.stringify(pkg));
          toast('分享包已导出', 'ok');
        };
      });
      el.querySelectorAll('#share-list .row').forEach((r) => {
        r.onclick = () => App.go('#/animal/' + r.dataset.id);
      });
    }
    el.querySelector('#share-q').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });

    el.querySelector('#btn-import').onclick = () => el.querySelector('#file-import').click();
    el.querySelector('#file-import').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let pkg;
      try {
        pkg = JSON.parse(await readFileAsText(file));
        validateShare(pkg);
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
        return;
      }
      try {
        const { animal, photoCount } = await importShare(pkg);
        toast(`已导入「${animal.name}」（${photoCount} 张照片）`, 'ok');
        App.go('#/animal/' + animal.id);
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
      }
    };

    renderList();
  },
};
