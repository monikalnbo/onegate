/* 渠道管理 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.channels = {
    title: '渠道管理',
    sub: '上游线路的接入、健康与用量',
    icon: 'server',
    async mount(root, ctx) {
      const RS = window.RS;
      let filter = { q: '', state: 'all' };

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取渠道…</div></div>`;

      async function load() {
        const [stateSnap, ov] = await Promise.all([RS.loadState(), RS.api('overview?range=24h').catch(() => null)]);
        render(stateSnap, ov);
      }

      function render(snap, ov) {
        const stats = new Map(((ov && ov.channels) || []).map(c => [c.id, c]));
        const channels = (snap.channels || []).map(c => {
          const st = stats.get(c.id) || {};
          const health = c.cooldown_ms > 0 ? 'cooldown' : (!c.enabled ? 'off' : 'ok');
          return { ...c, stat: st, health };
        });
        const rows = channels.filter(c => {
          if (filter.state === 'ok' && c.health !== 'ok') return false;
          if (filter.state === 'cooldown' && c.health !== 'cooldown') return false;
          if (filter.state === 'off' && c.health !== 'off') return false;
          if (filter.q && !(c.name + ' ' + c.base_url + ' ' + (c.models || []).join(',')).toLowerCase().includes(filter.q.toLowerCase())) return false;
          return true;
        });

        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div>
                <div class="card-title">上游渠道</div>
                <div class="card-sub">共 ${channels.length} 条 · 在线 ${channels.filter(c => c.enabled !== false).length} 条</div>
              </div>
              <div class="toolbar">
                <div style="position:relative">
                  <input class="input" id="chSearch" placeholder="搜索名称 / 地址 / 模型" value="${RS.esc(filter.q)}" style="padding-left:34px;min-width:240px">
                  <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted-2);width:15px;height:15px">${RS.icon('search')}</span>
                </div>
                <select class="select" id="chState" style="min-width:120px">
                  <option value="all"${filter.state === 'all' ? ' selected' : ''}>全部状态</option>
                  <option value="ok"${filter.state === 'ok' ? ' selected' : ''}>健康</option>
                  <option value="cooldown"${filter.state === 'cooldown' ? ' selected' : ''}>冷却中</option>
                  <option value="off"${filter.state === 'off' ? ' selected' : ''}>已停用</option>
                </select>
                <button class="btn btn-primary btn-sm" id="addChannel">${RS.icon('plus')} 新增渠道</button>
              </div>
            </div>
            <div class="card-body flush">
              ${rows.length ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>渠道</th><th>模型</th><th class="num">权重</th><th class="num">倍率</th><th class="num">并发</th><th>状态</th>
                  <th class="num">24h 请求</th><th class="num">失败率</th><th class="num">平均延迟</th><th class="num">操作</th>
                </tr></thead>
                <tbody>${rows.map(channelRow).join('')}</tbody>
              </table></div>`
              : `<div class="empty">${RS.icon('server')}<b>${channels.length ? '没有匹配的渠道' : '还没有渠道'}</b><span>${channels.length ? '换个筛选条件试试。' : '添加一条上游线路，填写 BASE_URL 与上游 KEY 即可开始转发。'}</span></div>`}
            </div>
          </section>

          <section class="card">
            <div class="card-header"><div><div class="card-title">接入提示</div><div class="card-sub">反代上游常用配置</div></div></div>
            <div class="card-body">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="input-label">子路径前缀</div>
                  <p class="input-hint" style="margin-top:0">反代挂在 <code class="inline">/openai/v1</code> 这类子路径时填写；重复的 <code class="inline">/v1</code> 会自动合并。</p>
                </div>
                <div>
                  <div class="input-label">自定义请求头</div>
                  <p class="input-hint" style="margin-top:0">JSON 对象，例如 <code class="inline">{"x-api-key":"abc"}</code>；<code class="inline">host</code> 与 <code class="inline">content-length</code> 不允许覆盖。</p>
                </div>
                <div>
                  <div class="input-label">模型列表</div>
                  <p class="input-hint" style="margin-top:0">上游没有 <code class="inline">/v1/models</code> 时手动填写，逗号分隔；<code class="inline">*</code> 表示全部。</p>
                </div>
                <div>
                  <div class="input-label">故障转移</div>
                  <p class="input-hint" style="margin-top:0">5xx / 429 / 超时会冷却该渠道并自动切换下一条，最多换两次。</p>
                </div>
              </div>
            </div>
          </section>
        </div>`;

        const search = root.querySelector('#chSearch');
        search.addEventListener('input', () => { filter.q = search.value; clearTimeout(search._t); search._t = setTimeout(() => { const pos = search.selectionStart; render(RS.state.state, ov); const el = root.querySelector('#chSearch'); el.focus(); el.setSelectionRange(pos, pos); }, 220); });
        root.querySelector('#chState').addEventListener('change', ev => { filter.state = ev.target.value; render(RS.state.state, ov); });
        root.querySelector('#addChannel').addEventListener('click', () => openForm(null));
        bindRows(ov);
      }

      function channelRow(c) {
        const badge = c.health === 'cooldown' ? `<span class="badge badge-amber"><i class="dot"></i>冷却 ${Math.ceil(c.cooldown_ms / 1000)}s</span>`
          : c.health === 'off' ? '<span class="badge badge-gray"><i class="dot"></i>已停用</span>'
          : '<span class="badge badge-green"><i class="dot"></i>健康</span>';
        const models = (c.models || []).slice(0, 3).map(m => `<span class="chip">${RS.esc(m)}</span>`).join(' ');
        const more = (c.models || []).length > 3 ? `<span class="chip">+${c.models.length - 3}</span>` : '';
        const failRate = c.stat.requests ? c.stat.failures / c.stat.requests : 0;
        return `<tr data-id="${RS.esc(c.id)}">
          <td>
            <div class="strong truncate" style="max-width:220px">${RS.esc(c.name)}</div>
            <div class="mono muted-2 truncate" style="max-width:230px;font-size:11px">${RS.esc(c.base_url)}${c.path_prefix ? '/' + RS.esc(c.path_prefix) : ''}</div>
          </td>
          <td>${models} ${more}</td>
          <td class="num mono">${c.weight || 1}</td>
          <td class="num mono">×${Number(c.rate_multiplier || 1)}</td>
          <td class="num mono" title="当前 ${c.limits ? c.limits.active : 0} 个在跑${c.limits && c.limits.waiting ? '，' + c.limits.waiting + ' 个排队' : ''}">${c.limits && c.limits.max_concurrency ? c.limits.active + '/' + c.limits.max_concurrency : '不限'}</td>
          <td>${badge}</td>
          <td class="num tabular">${RS.num(c.stat.requests || 0)}</td>
          <td class="num tabular" style="color:${failRate > .05 ? '#e11d48' : 'inherit'}">${c.stat.requests ? (failRate * 100).toFixed(1) + '%' : '—'}</td>
          <td class="num mono">${RS.ms(c.stat.avg_latency)}</td>
          <td class="num">
            <div class="inline-flex gap-1" style="justify-content:flex-end">
              <button class="btn btn-secondary btn-sm" data-act="test" title="发送一次探测请求">${RS.icon('zap')}</button>
              <button class="btn btn-secondary btn-sm" data-act="edit" title="编辑">${RS.icon('edit')}</button>
              <button class="btn btn-danger btn-sm" data-act="del" title="删除">${RS.icon('trash')}</button>
            </div>
          </td>
        </tr>`;
      }

      function bindRows(ov) {
        root.querySelectorAll('tr[data-id]').forEach(tr => {
          const id = tr.dataset.id;
          const channel = (RS.state.state.channels || []).find(c => c.id === id);
          tr.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
            const act = btn.dataset.act;
            if (act === 'edit') return openForm(channel);
            if (act === 'del') {
              const ok = await RS.confirmDialog({ title: '删除渠道', message: `确定删除「${channel.name}」？该渠道上的模型将不再被路由。`, danger: true, confirmText: '删除' });
              if (!ok) return;
              await RS.api('channels/' + encodeURIComponent(id), { method: 'DELETE' });
              RS.toast('渠道已删除');
              await load();
              return;
            }
            if (act === 'test') {
              btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
              try {
                const res = await RS.api('channels/' + encodeURIComponent(id) + '/test', { method: 'POST' });
                if (res.ok) RS.toast(`自检通过 · ${res.latency_ms} ms`);
                else RS.toast('自检失败：' + (res.error || '未知错误'), 'error');
              } catch (err) { RS.toast('自检失败：' + err.message, 'error'); }
              finally { btn.disabled = false; btn.innerHTML = RS.icon('zap'); }
            }
          }));
        });
      }

      function openForm(channel) {
        const editing = !!channel;
        const c = channel || { name: '', base_url: '', path_prefix: '', api_key: '', models: ['*'], weight: 1, enabled: true, headers: {} };
        const root2 = RS.modal({
          title: editing ? '编辑渠道' : '新增渠道',
          sub: editing ? c.name : '填写上游 Base URL 与密钥',
          wide: true,
          body: `
            <div class="grid grid-cols-2 gap-4">
              <div class="field"><label class="input-label">渠道名称</label>
                <input class="input" id="fName" value="${RS.esc(c.name)}" placeholder="例如 主力线 · 香港"></div>
              <div class="field"><label class="input-label">权重</label>
                <input class="input" id="fWeight" type="number" min="1" value="${c.weight || 1}">
                <p class="input-hint">同模型多渠道时按权重轮询，越大越常命中。</p></div>
            </div>
            <div class="field"><label class="input-label">BASE_URL</label>
              <input class="input" id="fBase" value="${RS.esc(c.base_url)}" placeholder="https://api.example.com 或反代根地址">
              <p class="input-hint">不带 <code class="inline">/v1</code> 也可以；请求会拼成 <code class="inline">BASE_URL/前缀/chat/completions</code>。</p></div>
            <div class="grid grid-cols-2 gap-4">
              <div class="field"><label class="input-label">路径前缀</label>
                <input class="input" id="fPrefix" value="${RS.esc(c.path_prefix || '')}" placeholder="openai/v1"></div>
              <div class="field"><label class="input-label">上游 KEY</label>
                <input class="input" id="fKey" type="password" value="" placeholder="${editing ? '留空表示不修改（当前 ' + RS.esc(c.api_key || '—') + '）' : 'sk-...'}" autocomplete="off">
                <p class="input-hint">加密存盘，界面与日志只显示掩码。</p></div>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div class="field"><label class="input-label">倍率</label>
                <input class="input" id="fMultiplier" type="number" min="0.01" max="100" step="0.01" value="${Number(c.rate_multiplier || 1)}">
                <p class="input-hint">价格表 × 倍率 = 实扣。</p></div>
              <div class="field"><label class="input-label">并发上限</label>
                <input class="input" id="fConcurrency" type="number" min="0" max="512" value="${Number(c.max_concurrency || 0)}">
                <p class="input-hint">0 = 不限，防挤爆。</p></div>
              <div class="field"><label class="input-label">超时（毫秒）</label>
                <input class="input" id="fTimeout" type="number" min="1000" max="600000" value="${Number(c.timeout_ms || 300000)}"></div>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div class="field"><label class="input-label">排队等待（毫秒）</label>
                <input class="input" id="fQueueMs" type="number" min="0" max="60000" value="${Number(c.queue_ms || 0)}">
                <p class="input-hint">0 = 满员直接拒绝。</p></div>
              <div class="field"><label class="input-label">排队人数上限</label>
                <input class="input" id="fMaxQueue" type="number" min="0" max="1000" value="${Number(c.max_queue || 0)}"></div>
              <div class="field"><label class="input-label">失败重试次数</label>
                <input class="input" id="fRetries" type="number" min="0" max="2" value="${Number(c.retries ?? 2)}"></div>
            </div>
            <div class="field"><label class="input-label">模型别名（JSON，可留空）</label>
              <textarea class="textarea" id="fAliases" placeholder='{"gpt-4o":"gpt-4o-2024-11-20"}'>${RS.esc(Object.keys(c.model_aliases || {}).length ? JSON.stringify(c.model_aliases, null, 2) : '')}</textarea>
              <p class="input-hint">左侧是对外模型名，右侧是上游真实模型名。</p></div>
            <div class="field"><label class="input-label">模型列表</label>
              <input class="input" id="fModels" value="${RS.esc((c.models || ['*']).join(', '))}" placeholder="gpt-4o, claude-sonnet-4.5 或 *">
              <p class="input-hint">逗号分隔；<code class="inline">*</code> 表示该渠道承接全部模型。</p></div>
            <div class="field"><label class="input-label">自定义请求头（JSON）</label>
              <textarea class="textarea" id="fHeaders" placeholder='{"x-api-key":"abc","User-Agent":"relay/1.0"}'>${RS.esc(Object.keys(c.headers || {}).length ? JSON.stringify(c.headers, null, 2) : '')}</textarea></div>
            <label class="flex items-center gap-2" style="cursor:pointer">
              <span class="switch"><input type="checkbox" id="fEnabled" ${c.enabled !== false ? 'checked' : ''}><span></span></span>
              <span class="text-sm">启用该渠道</span>
            </label>
            <p class="field-error" id="fErr"></p>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button>
                   <button class="btn btn-primary" id="fSave">${editing ? '保存修改' : '创建渠道'}</button>`
        });
        root2.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        root2.querySelector('#fSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          const payload = {
            name: root2.querySelector('#fName').value.trim() || 'Channel',
            base_url: root2.querySelector('#fBase').value.trim(),
            path_prefix: root2.querySelector('#fPrefix').value.trim(),
            models: root2.querySelector('#fModels').value.split(',').map(s => s.trim()).filter(Boolean),
            weight: Math.max(1, Number(root2.querySelector('#fWeight').value) || 1),
            rate_multiplier: Number(root2.querySelector('#fMultiplier').value) || 1,
            max_concurrency: Math.max(0, Number(root2.querySelector('#fConcurrency').value) || 0),
            queue_ms: Math.max(0, Number(root2.querySelector('#fQueueMs').value) || 0),
            max_queue: Math.max(0, Number(root2.querySelector('#fMaxQueue').value) || 0),
            timeout_ms: Math.max(1000, Number(root2.querySelector('#fTimeout').value) || 300000),
            retries: Math.max(0, Number(root2.querySelector('#fRetries').value) || 0),
            enabled: root2.querySelector('#fEnabled').checked
          };
          if (!payload.models.length) payload.models = ['*'];
          const key = root2.querySelector('#fKey').value.trim();
          if (key) payload.api_key = key;
          const headersRaw = root2.querySelector('#fHeaders').value.trim();
          if (headersRaw) {
            try { payload.headers = JSON.parse(headersRaw); }
            catch (e) { root2.querySelector('#fErr').textContent = '自定义请求头不是合法 JSON'; return; }
          } else payload.headers = {};
          const aliasesRaw = root2.querySelector('#fAliases').value.trim();
          if (aliasesRaw) {
            try {
              const parsed = JSON.parse(aliasesRaw);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
              payload.model_aliases = parsed;
            } catch (e) { root2.querySelector('#fErr').textContent = '模型别名必须是 JSON 对象，例如 {"gpt-4o":"gpt-4o-2024-11-20"}'; return; }
          } else payload.model_aliases = {};
          if (!payload.base_url) { root2.querySelector('#fErr').textContent = '请填写 BASE_URL'; return; }
          if (!editing && !payload.api_key) { root2.querySelector('#fErr').textContent = '请填写上游 KEY'; return; }
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
          try {
            if (editing) await RS.api('channels/' + encodeURIComponent(channel.id), { method: 'PATCH', body: payload });
            else await RS.api('channels', { method: 'POST', body: payload });
            RS.closeModal(); RS.toast(editing ? '渠道已更新' : '渠道已创建');
            await load();
          } catch (err) {
            root2.querySelector('#fErr').textContent = err.message;
            btn.disabled = false; btn.textContent = editing ? '保存修改' : '创建渠道';
          }
        });
      }

      await load();
      ctx.poll(async () => { await load(); }, 25000);
    }
  };
})();
