/* 模型来源 = 上游渠道（密钥 / BASE_URL / 模型 / 倍率 / 并发 / 超时重试）+ 来源分组
 * 两种编辑方式并存：点击式表单（小白）与整份 JSON（可脚本化、可备份），保存前都会校验。
 * 密钥永远只显示掩码；JSON 里留空表示「不修改」。 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.sources = {
    title: '模型来源',
    sub: '上游密钥、BASE_URL、开放模型、倍率、并发上限与来源分组',
    icon: 'server',
    async mount(root, ctx) {
      const RS = window.RS;
      let sources = [], groups = [], mode = 'cards';

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取来源配置…</div></div>`;

      async function load() {
        // channels 已带 limits 快照（并发/排队实时值），source-groups 提供分组。
        const [list, groupResult] = await Promise.all([RS.api('channels'), RS.api('source-groups')]);
        sources = Array.isArray(list) ? list : [];
        groups = groupList(groupResult);
        render();
      }

      function healthBadge(s) {
        if (s.enabled === false) return '<span class="badge badge-gray">已停用</span>';
        if (s.cooldown_ms > 0) return `<span class="badge badge-amber">冷却 ${Math.ceil(s.cooldown_ms / 1000)}s</span>`;
        const lim = s.limits || {};
        if (lim.max_concurrency && lim.active >= lim.max_concurrency) return '<span class="badge badge-amber">并发已满</span>';
        return '<span class="badge badge-green">正常</span>';
      }

      function render() {
        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div><div class="card-title">模型来源</div><div class="card-sub">共 ${sources.length} 个来源 · ${groups.length} 个来源分组 · 密钥只显示掩码</div></div>
              <div class="toolbar">
                <div class="inline-flex gap-1" role="tablist">
                  <button class="btn btn-sm ${mode === 'cards' ? 'btn-primary' : 'btn-secondary'}" data-mode="cards">逐项设置</button>
                  <button class="btn btn-sm ${mode === 'json' ? 'btn-primary' : 'btn-secondary'}" data-mode="json">JSON 编辑</button>
                </div>
                <button class="btn btn-primary btn-sm" id="sNew">${RS.icon('plus')} 新增来源</button>
              </div>
            </div>
            <div class="card-body flush" id="sBody"></div>
          </section>
          <section class="card">
            <div class="card-header"><div><div class="card-title">来源分组</div><div class="card-sub">把同一供应商的多个来源归到一组，调用记录里按组归类</div></div>
              <div class="toolbar"><button class="btn btn-secondary btn-sm" id="gNew">${RS.icon('plus')} 新建来源组</button></div></div>
            <div class="card-body flush">
              ${groups.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>来源组</th><th>包含来源</th><th class="num">数量</th><th>备注</th><th class="num">操作</th></tr></thead>
                <tbody>${groups.map(g => `<tr data-gid="${RS.esc(g.id)}">
                  <td class="strong">${RS.esc(g.name)} ${g.enabled === false ? '<span class="badge badge-gray">停用</span>' : ''}</td>
                  <td>${(g.channel_ids || []).map(id => {
                    const s = sources.find(x => x.id === id);
                    return `<div class="text-xs">${RS.esc(s ? s.name : id)}${s ? '' : ' <span class="badge badge-red">已删除</span>'}</div>`;
                  }).join('') || '<span class="muted-2">未绑定来源</span>'}</td>
                  <td class="num tabular">${(g.channel_ids || []).length}</td>
                  <td class="muted truncate" style="max-width:200px">${RS.esc(g.note || '—')}</td>
                  <td class="num"><div class="inline-flex gap-1" style="justify-content:flex-end">
                    <button class="btn btn-secondary btn-sm" data-gact="edit">${RS.icon('edit')}</button>
                    <button class="btn btn-danger btn-sm" data-gact="del">${RS.icon('trash')}</button>
                  </div></td>
                </tr>`).join('')}</tbody></table></div>`
                : `<div class="empty">${RS.icon('server')}<b>还没有来源分组</b><span>把同一供应商的来源归到一组，例如「ZCode GLM」。未归组的来源仍然正常转发，只是调用记录里显示为「未归组」。</span></div>`}
            </div>
          </section>
        </div>`;

        root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
        root.querySelector('#sNew').addEventListener('click', () => openForm(null));
        root.querySelector('#gNew').addEventListener('click', () => openGroupForm(null));
        root.querySelectorAll('tr[data-gid]').forEach(tr => {
          const g = groups.find(x => x.id === tr.dataset.gid);
          tr.querySelector('[data-gact="edit"]').addEventListener('click', () => openGroupForm(g));
          tr.querySelector('[data-gact="del"]').addEventListener('click', async () => {
            const ok = await RS.confirmDialog({ title: '删除来源组', message: `删除「${g.name}」只影响归类展示，不会删除任何来源或密钥。`, danger: true, confirmText: '删除' });
            if (!ok) return;
            try { await RS.api('source-groups/' + encodeURIComponent(g.id), { method: 'DELETE' }); RS.toast('来源组已删除'); await load(); } catch (err) { RS.toast(err.message, 'error'); }
          });
        });

        if (mode === 'json') renderJson();
        else renderCards();
      }

      /* ---------------- 点击式：来源卡片 ---------------- */
      function renderCards() {
        const body = root.querySelector('#sBody');
        if (!sources.length) {
          body.innerHTML = `<div class="empty">${RS.icon('server')}<b>还没有模型来源</b><span>点右上角「新增来源」，填 BASE_URL 与密钥，再勾选要开放的模型。</span></div>`;
          return;
        }
        body.innerHTML = `<div class="card-body"><div class="grid grid-cols-2 gap-4">${sources.map(sourceCard).join('')}</div></div>`;
        sources.forEach(s => {
          const card = body.querySelector(`[data-sid="${CSS.escape(s.id)}"]`);
          if (!card) return;
          card.querySelector('[data-sact="edit"]').addEventListener('click', () => openForm(s));
          card.querySelector('[data-sact="test"]').addEventListener('click', async ev => {
            const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
            try {
              const res = await RS.api('channels/' + encodeURIComponent(s.id) + '/test', { method: 'POST' });
              res.ok ? RS.toast(`自检通过 · ${res.latency_ms} ms`) : RS.toast('自检失败：' + (res.error || '未知错误'), 'error');
            } catch (err) { RS.toast('自检失败：' + err.message, 'error'); }
            finally { btn.disabled = false; btn.innerHTML = RS.icon('zap') + ' 自检'; }
          });
          card.querySelector('[data-sact="del"]').addEventListener('click', async () => {
            const ok = await RS.confirmDialog({ title: '删除来源', message: `确定删除「${s.name}」？该来源承接的模型会失去一条上游线路。`, danger: true, confirmText: '删除' });
            if (!ok) return;
            try { await RS.api('channels/' + encodeURIComponent(s.id), { method: 'DELETE' }); RS.toast('来源已删除'); await load(); } catch (err) { RS.toast(err.message, 'error'); }
          });
          const toggle = card.querySelector('[data-sact="toggle"]');
          if (toggle) toggle.addEventListener('change', async () => {
            try { await RS.api('channels/' + encodeURIComponent(s.id), { method: 'PATCH', body: { enabled: toggle.checked } }); RS.toast(toggle.checked ? '来源已启用' : '来源已停用'); await load(); }
            catch (err) { toggle.checked = !toggle.checked; RS.toast(err.message, 'error'); }
          });
        });
      }

      function sourceCard(s) {
        const lim = s.limits || {};
        const models = (s.models || []).slice(0, 4).map(m => `<span class="chip">${RS.esc(m)}</span>`).join(' ');
        const more = (s.models || []).length > 4 ? `<span class="chip">+${s.models.length - 4}</span>` : '';
        const aliases = Object.entries(s.model_aliases || {});
        return `<article class="card" data-sid="${RS.esc(s.id)}" style="box-shadow:none">
          <div class="card-body">
            <div class="flex items-start justify-between gap-3">
              <div style="min-width:0">
                <div class="strong truncate" style="font-size:15px">${RS.esc(s.name)}</div>
                <div class="mono muted-2 truncate text-xs" title="${RS.esc(s.base_url)}">${RS.esc(s.base_url)}${s.path_prefix ? '/' + RS.esc(s.path_prefix) : ''}</div>
              </div>
              <div class="inline-flex gap-1" style="flex:none">${healthBadge(s)}</div>
            </div>
            <div class="grid grid-cols-4 gap-2" style="margin:12px 0">
              <div><div class="input-label" style="margin-bottom:2px">倍率</div><div class="tabular strong">×${Number(s.rate_multiplier || 1)}</div></div>
              <div><div class="input-label" style="margin-bottom:2px">并发上限</div><div class="tabular strong">${lim.max_concurrency || '不限'}</div><div class="text-xs muted">当前 ${lim.active || 0}${lim.waiting ? ` · 排队 ${lim.waiting}` : ''}</div></div>
              <div><div class="input-label" style="margin-bottom:2px">超时</div><div class="tabular">${Math.round((s.timeout_ms || 300000) / 1000)}s</div></div>
              <div><div class="input-label" style="margin-bottom:2px">重试</div><div class="tabular">${Number(s.retries ?? 2)} 次</div></div>
            </div>
            <div class="text-xs muted" style="margin-bottom:4px">密钥 <span class="mono">${RS.esc(s.api_key || '—')}</span></div>
            <div style="margin-bottom:10px">${models} ${more}${aliases.length ? `<div class="text-xs muted" style="margin-top:4px">别名 ${aliases.map(([a, b]) => `<span class="mono">${RS.esc(a)}→${RS.esc(b)}</span>`).join('、')}</div>` : ''}</div>
            <div class="inline-flex gap-1 items-center">
              <button class="btn btn-secondary btn-sm" data-sact="test">${RS.icon('zap')} 自检</button>
              <button class="btn btn-secondary btn-sm" data-sact="edit">${RS.icon('edit')} 设置</button>
              <label class="flex items-center gap-2 text-xs" style="cursor:pointer;margin-left:6px"><span class="switch"><input type="checkbox" data-sact="toggle" ${s.enabled !== false ? 'checked' : ''}><span></span></span> 启用</label>
              <button class="btn btn-danger btn-sm" style="margin-left:auto" data-sact="del">${RS.icon('trash')}</button>
            </div>
          </div>
        </article>`;
      }

      /* ---------------- 点击式：来源表单 ---------------- */
      function openForm(source) {
        const editing = !!source;
        const s = source || { name: '', base_url: '', path_prefix: '', api_key: '', models: [], model_aliases: {}, rate_multiplier: 1, max_concurrency: 0, queue_ms: 0, max_queue: 0, timeout_ms: 300000, retries: 2, weight: 1, enabled: true, headers: {} };
        const known = [...new Set(sources.flatMap(x => x.models || []))].filter(m => m !== '*').sort();
        const checked = new Set((s.models || []).filter(m => m !== '*'));
        const allowAll = (s.models || []).includes('*');
        const m = RS.modal({
          title: editing ? '设置来源' : '新增来源',
          sub: editing ? `${s.name} · 密钥 ${s.api_key || '—'}` : '填入上游 BASE_URL 与密钥，再选要开放的模型',
          wide: true,
          body: `
            <form id="sForm">
              <div class="grid grid-cols-2 gap-4">
                <div class="field"><label class="input-label">来源名称</label><input class="input" id="fName" value="${RS.esc(s.name)}" placeholder="例如 ZCode GLM 主号池"></div>
                <div class="field"><label class="input-label">权重</label><input class="input" id="fWeight" type="number" min="1" value="${s.weight || 1}"><p class="input-hint">同一模型多个来源时按权重分配流量。</p></div>
              </div>
              <div class="field"><label class="input-label">BASE_URL</label><input class="input" id="fBase" value="${RS.esc(s.base_url)}" placeholder="https://api.example.com/v1"><p class="input-hint">直接填到 /v1 或根地址都可以，重复的 /v1 会自动合并。</p></div>
              <div class="grid grid-cols-2 gap-4">
                <div class="field"><label class="input-label">路径前缀（可选）</label><input class="input" id="fPrefix" value="${RS.esc(s.path_prefix || '')}" placeholder="openai/v1"></div>
                <div class="field"><label class="input-label">上游密钥</label><input class="input" id="fKey" type="password" autocomplete="off" value="" placeholder="${editing ? '留空表示不修改（当前 ' + RS.esc(s.api_key || '—') + '）' : 'sk-...'}"><p class="input-hint">加密后存盘，界面与日志里只显示掩码。</p></div>
              </div>
              <div class="field"><label class="input-label">开放模型</label>
                <div class="flex items-center gap-2" style="margin-bottom:6px"><label class="flex items-center gap-2 text-sm"><span class="switch"><input type="checkbox" id="fAll" ${allowAll ? 'checked' : ''}><span></span></span> 开放该来源支持的全部模型（*）</label></div>
                <div id="fModels" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;border:1px solid var(--border);border-radius:10px;max-height:150px;overflow:auto">
                  ${known.length ? known.map(id => `<label class="flex items-center gap-2 text-sm" style="cursor:pointer"><input type="checkbox" class="sModel" value="${RS.esc(id)}" ${checked.has(id) ? 'checked' : ''} ${allowAll ? 'disabled' : ''}> ${RS.esc(id)}</label>`).join('') : '<span class="muted-2 text-sm">还没有可选的模型：先在「模型广场」里配置价格，或直接手填。</span>'}
                </div>
                <div class="flex gap-2" style="margin-top:6px">
                  <input class="input" id="fModelManual" placeholder="手填模型名，回车添加" ${allowAll ? 'disabled' : ''}>
                  <button class="btn btn-secondary btn-sm" type="button" id="fModelAdd">添加</button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="field"><label class="input-label">倍率</label><input class="input" id="fMultiplier" type="number" min="0.01" max="100" step="0.01" value="${Number(s.rate_multiplier || 1)}"><p class="input-hint">0.5 = 半价，2 = 双倍。实际扣费 = 价格表 × 倍率。</p></div>
                <div class="field"><label class="input-label">并发上限</label><input class="input" id="fConcurrency" type="number" min="0" max="512" value="${Number(s.max_concurrency || 0)}"><p class="input-hint">0 = 不限；填 5 表示同时最多 5 个请求在跑，防止把上游挤爆。</p></div>
              </div>
              <div class="grid grid-cols-3 gap-4">
                <div class="field"><label class="input-label">排队等待（毫秒）</label><input class="input" id="fQueueMs" type="number" min="0" max="60000" value="${Number(s.queue_ms || 0)}"><p class="input-hint">超出并发时最多等多久，0 = 直接拒绝。</p></div>
                <div class="field"><label class="input-label">排队人数上限</label><input class="input" id="fMaxQueue" type="number" min="0" max="1000" value="${Number(s.max_queue || 0)}"></div>
                <div class="field"><label class="input-label">超时（毫秒）</label><input class="input" id="fTimeout" type="number" min="1000" max="600000" value="${Number(s.timeout_ms || 300000)}"></div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="field"><label class="input-label">失败重试次数</label><input class="input" id="fRetries" type="number" min="0" max="2" value="${Number(s.retries ?? 2)}"><p class="input-hint">只对 429 / 5xx 重试，最多 2 次。</p></div>
                <div class="field"><label class="input-label">模型别名（JSON，可留空）</label><textarea class="textarea" id="fAliases" placeholder='{"gpt-4o":"gpt-4o-2024-11-20"}'>${RS.esc(Object.keys(s.model_aliases || {}).length ? JSON.stringify(s.model_aliases, null, 2) : '')}</textarea></div>
              </div>
              <div class="field"><label class="input-label">自定义请求头（JSON，可留空）</label><textarea class="textarea" id="fHeaders" placeholder='{"User-Agent":"relay/1.0"}'>${RS.esc(Object.keys(s.headers || {}).length ? JSON.stringify(s.headers, null, 2) : '')}</textarea></div>
              <label class="flex items-center gap-2" style="cursor:pointer"><span class="switch"><input type="checkbox" id="fEnabled" ${s.enabled !== false ? 'checked' : ''}><span></span></span><span class="text-sm">启用该来源</span></label>
              <p class="field-error" id="fErr"></p>
            </form>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" id="fSave">${editing ? '保存修改' : '创建来源'}</button>`
        });

        const q = id => m.querySelector(id);
        q('#fAll').addEventListener('change', () => {
          const all = q('#fAll').checked;
          m.querySelectorAll('.sModel').forEach(x => { x.disabled = all; });
          q('#fModelManual').disabled = all;
        });
        const addManual = () => {
          const value = q('#fModelManual').value.trim();
          if (!value) return;
          if (![...m.querySelectorAll('.sModel')].some(x => x.value === value)) {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-2 text-sm';
            label.style.cursor = 'pointer';
            label.innerHTML = `<input type="checkbox" class="sModel" value="${RS.esc(value)}" checked> ${RS.esc(value)}`;
            q('#fModels').appendChild(label);
          } else {
            const box = [...m.querySelectorAll('.sModel')].find(x => x.value === value);
            box.checked = true;
          }
          q('#fModelManual').value = '';
        };
        q('#fModelAdd').addEventListener('click', addManual);
        q('#fModelManual').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addManual(); } });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        q('#fSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          const parse = (value, label) => {
            if (!value.trim()) return {};
            try { const obj = JSON.parse(value); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not object'); return obj; }
            catch { throw new Error(label + ' 不是合法的 JSON 对象'); }
          };
          const models = q('#fAll').checked ? ['*'] : [...m.querySelectorAll('.sModel:checked')].map(x => x.value);
          if (!models.length) { q('#fErr').textContent = '至少要选一个开放的模型（或勾选「全部模型」）'; return; }
          if (!q('#fBase').value.trim()) { q('#fErr').textContent = '请填写 BASE_URL'; return; }
          if (!editing && !q('#fKey').value.trim()) { q('#fErr').textContent = '请填写上游密钥'; return; }
          let aliases, headers;
          try { aliases = parse(q('#fAliases').value, '模型别名'); headers = parse(q('#fHeaders').value, '自定义请求头'); }
          catch (err) { q('#fErr').textContent = err.message; return; }
          const payload = {
            name: q('#fName').value.trim() || '来源',
            base_url: q('#fBase').value.trim(),
            path_prefix: q('#fPrefix').value.trim(),
            models, model_aliases: aliases, headers,
            weight: Math.max(1, Number(q('#fWeight').value) || 1),
            rate_multiplier: Number(q('#fMultiplier').value) || 1,
            max_concurrency: Math.max(0, Number(q('#fConcurrency').value) || 0),
            queue_ms: Math.max(0, Number(q('#fQueueMs').value) || 0),
            max_queue: Math.max(0, Number(q('#fMaxQueue').value) || 0),
            timeout_ms: Math.max(1000, Number(q('#fTimeout').value) || 300000),
            retries: Math.max(0, Number(q('#fRetries').value) || 0),
            enabled: q('#fEnabled').checked
          };
          const key = q('#fKey').value.trim();
          if (key) payload.api_key = key;
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
          try {
            if (editing) await RS.api('channels/' + encodeURIComponent(source.id), { method: 'PATCH', body: payload });
            else await RS.api('channels', { method: 'POST', body: payload });
            RS.closeModal(); RS.toast(editing ? '来源已保存' : '来源已创建');
            await load();
          } catch (err) {
            q('#fErr').textContent = err.message;
            btn.disabled = false; btn.textContent = editing ? '保存修改' : '创建来源';
          }
        });
      }

      /* ---------------- JSON 编辑：整份配置 ---------------- */
      let jsonDraft = null;
      function renderJson() {
        const body = root.querySelector('#sBody');
        const conf = jsonDraft || {
          version: 1,
          sources: sources.map(s => ({
            id: s.id, name: s.name, base_url: s.base_url, path_prefix: s.path_prefix || '',
            api_key: '', models: s.models || ['*'], model_aliases: s.model_aliases || {},
            rate_multiplier: Number(s.rate_multiplier || 1), max_concurrency: Number(s.max_concurrency || 0),
            queue_ms: Number(s.queue_ms || 0), max_queue: Number(s.max_queue || 0),
            timeout_ms: Number(s.timeout_ms || 300000), retries: Number(s.retries ?? 2),
            weight: Number(s.weight || 1), enabled: s.enabled !== false, headers: s.headers || {}
          }))
        };
        body.innerHTML = `<div class="card-body">
          <div class="flex items-center justify-between" style="margin-bottom:8px">
            <div class="text-sm muted">整份配置就是一个 JSON：<code class="inline">sources[]</code> 里每个对象是一家上游。<br>
              · 改 <code class="inline">rate_multiplier</code> 调倍率，改 <code class="inline">max_concurrency</code> 调并发；<br>
              · <code class="inline">api_key</code> 留空 = 保持原密钥（不会把密钥回显到页面）；<br>
              · 删掉某个对象 = 删除该来源（会二次确认）。</div>
            <div class="inline-flex gap-2">
              <button class="btn btn-secondary btn-sm" id="jReload">重新载入</button>
              <button class="btn btn-secondary btn-sm" id="jValidate">校验</button>
              <button class="btn btn-primary btn-sm" id="jSave">保存 JSON</button>
            </div>
          </div>
          <textarea class="textarea mono" id="jBox" spellcheck="false" style="min-height:420px;font-size:12px;line-height:1.55">${RS.esc(JSON.stringify(conf, null, 2))}</textarea>
          <p class="field-error" id="jErr"></p>
          <p class="input-hint" id="jOk"></p>
        </div>`;
        const box = body.querySelector('#jBox');
        const err = body.querySelector('#jErr'), ok = body.querySelector('#jOk');
        const parse = () => {
          let doc;
          try { doc = JSON.parse(box.value); } catch (e) { throw new Error('JSON 语法错误：' + e.message); }
          if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.sources)) throw new Error('JSON 顶层需要是一个对象，并且包含 sources 数组');
          const seen = new Set();
          for (const [i, s] of doc.sources.entries()) {
            const at = `sources[${i}]`;
            if (!s || typeof s !== 'object') throw new Error(`${at} 不是对象`);
            if (!String(s.name || '').trim()) throw new Error(`${at}.name 不能为空`);
            if (!/^https?:\/\//i.test(String(s.base_url || ''))) throw new Error(`${at}.base_url 必须是 http(s) 地址`);
            if (!Array.isArray(s.models) || !s.models.length) throw new Error(`${at}.models 至少要有一个模型，或用 ["*"]`);
            if (!s.id) s.id = 'new-' + i;
            if (seen.has(s.id)) throw new Error(`来源 id 重复：${s.id}`);
            seen.add(s.id);
            if (!(Number(s.rate_multiplier ?? 1) >= 0.01 && Number(s.rate_multiplier ?? 1) <= 100)) throw new Error(`${at}.rate_multiplier 需在 0.01 到 100 之间`);
            if (!(Number(s.max_concurrency ?? 0) >= 0 && Number(s.max_concurrency ?? 0) <= 512)) throw new Error(`${at}.max_concurrency 需在 0 到 512 之间（0 = 不限）`);
            if (s.model_aliases !== undefined && (typeof s.model_aliases !== 'object' || Array.isArray(s.model_aliases))) throw new Error(`${at}.model_aliases 必须是对象`);
          }
          return doc;
        };
        body.querySelector('#jValidate').addEventListener('click', () => {
          err.textContent = ''; ok.textContent = '';
          try { const doc = parse(); ok.textContent = `校验通过：${doc.sources.length} 个来源。点「保存 JSON」才会真正生效。`; }
          catch (e) { err.textContent = e.message; }
        });
        body.querySelector('#jReload').addEventListener('click', () => { jsonDraft = null; render(); });
        body.querySelector('#jSave').addEventListener('click', async ev => {
          err.textContent = ''; ok.textContent = '';
          let doc;
          try { doc = parse(); } catch (e) { err.textContent = e.message; return; }
          const dropped = sources.filter(s => !doc.sources.some(x => x.id === s.id));
          if (dropped.length) {
            const yes = await RS.confirmDialog({ title: '删除来源', message: `这份 JSON 里少了 ${dropped.length} 个来源：${dropped.map(s => s.name).join('、')}。保存后会从配置中删除它们，其模型将不再被路由。`, danger: true, confirmText: '继续保存' });
            if (!yes) return;
          }
          const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
          try {
            const res = await RS.api('sources/config', { method: 'PUT', body: doc });
            jsonDraft = null;
            RS.toast(`已保存：更新 ${res.updated} 个、新增 ${res.created} 个`);
            await load();
          } catch (e) {
            err.textContent = e.message;
            btn.disabled = false; btn.textContent = '保存 JSON';
          }
        });
      }

      /* ---------------- 来源分组表单 ---------------- */
      // 来源组接口返回 { items: [...] }，这里兼容两种形状，避免误把对象当数组。
      function groupList(value) {
        return Array.isArray(value) ? value : (value && Array.isArray(value.items) ? value.items : []);
      }
      function openGroupForm(g) {
        const editing = !!g;
        const picked = new Set((g && g.channel_ids) || []);
        const m = RS.modal({
          title: editing ? '编辑来源组' : '新建来源组',
          sub: editing ? g.name : '例如 ZCode GLM / OpenAI / 自建',
          body: `
            <form id="gForm">
              <div class="field"><label class="input-label" for="gName">名称</label><input class="input" id="gName" name="name" maxlength="60" value="${RS.esc(editing ? g.name : '')}" placeholder="ZCode GLM"></div>
              <div class="field"><label class="input-label">包含来源</label>
                <div style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--border);border-radius:10px;max-height:220px;overflow:auto">
                  ${sources.length ? sources.map(s => `<label class="flex items-center gap-2 text-sm" style="cursor:pointer"><input type="checkbox" class="gChannel" value="${RS.esc(s.id)}" ${picked.has(s.id) ? 'checked' : ''}> ${RS.esc(s.name)} <span class="muted-2 text-xs">${RS.esc((s.models || []).slice(0, 3).join(' / '))}</span></label>`).join('') : '<span class="muted-2 text-sm">还没有来源</span>'}
                </div>
              </div>
              <div class="field"><label class="input-label" for="gNote">备注</label><input class="input" id="gNote" name="note" maxlength="200" value="${RS.esc(editing ? (g.note || '') : '')}"></div>
              <p class="field-error" id="gErr"></p>
            </form>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" id="gSave">${editing ? '保存' : '创建'}</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#gSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          const payload = {
            name: m.querySelector('#gName').value.trim(),
            channel_ids: [...m.querySelectorAll('.gChannel:checked')].map(x => x.value),
            note: m.querySelector('#gNote').value.trim()
          };
          if (!payload.name) { m.querySelector('#gErr').textContent = '请填写名称'; return; }
          btn.disabled = true;
          try {
            if (editing) await RS.api('source-groups/' + encodeURIComponent(g.id), { method: 'PATCH', body: payload });
            else await RS.api('source-groups', { method: 'POST', body: payload });
            RS.closeModal(); RS.toast(editing ? '来源组已保存' : '来源组已创建'); await load();
          } catch (err) { m.querySelector('#gErr').textContent = err.message; btn.disabled = false; }
        });
      }

      await load();
      ctx.poll(async () => { await load(); }, 30000);
    }
  };
})();
