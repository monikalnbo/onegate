/* API 密钥 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.keys = {
    title: 'API 密钥',
    sub: '下游调用凭据与用量',
    icon: 'key',
    async mount(root, ctx) {
      const RS = window.RS;
      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取密钥…</div></div>`;

      let groups = [];
      async function load() {
        const [snap, g] = await Promise.all([RS.loadState(), RS.api('groups').catch(() => [])]);
        groups = g || [];
        render(snap);
      }

      function render(snap) {
        const keys = snap.keys || [];
        const stats = (snap.stats && snap.stats.keys) || {};

        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div>
                <div class="card-title">API 密钥</div>
                <div class="card-sub">共 ${keys.length} 个 · 启用 ${keys.filter(k => k.enabled !== false).length} 个</div>
              </div>
              <div class="toolbar">
                <button class="btn btn-secondary btn-sm" id="copyBase">${RS.icon('copy')} 复制接入地址</button>
                <button class="btn btn-primary btn-sm" id="newKey">${RS.icon('plus')} 生成密钥</button>
              </div>
            </div>
            <div class="card-body flush">
              ${keys.length ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>名称</th><th>密钥</th><th>归属 / 分组</th><th class="num">项目预算 / 额度</th><th class="num">RPM</th><th class="num">累计请求</th>
                  <th class="num">Token</th><th>最近使用</th><th>状态</th><th class="num">操作</th>
                </tr></thead>
                <tbody>${keys.map(k => keyRow(k, stats[k.id])).join('')}</tbody>
              </table></div>`
              : `<div class="empty">${RS.icon('key')}<b>还没有 API 密钥</b><span>生成一个密钥交给客户端使用；明文只在创建时显示一次。</span></div>`}
            </div>
            <div class="card-footer">
              <p class="input-hint" style="margin:0 0 8px">客户密钥显示项目预算；账户余额与加额在用户管理。</p>
              <div class="flex items-center gap-2 text-xs muted">
                ${RS.icon('globe')} 接入地址 <code class="inline">${RS.esc(apiBase())}</code>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-header"><div><div class="card-title">调用示例</div><div class="card-sub">OpenAI 兼容协议，改 Base URL 即可</div></div></div>
            <div class="card-body">
              <div class="code-block"><button class="btn btn-secondary btn-sm copy-btn" id="copyCurl" aria-label="复制">${RS.icon('copy')}</button>${RS.esc(curl())}</div>
            </div>
          </section>
        </div>`;

        root.querySelector('#newKey').addEventListener('click', openCreate);
        root.querySelector('#copyBase').addEventListener('click', ev => RS.copy(apiBase(), ev.currentTarget));
        root.querySelector('#copyCurl').addEventListener('click', ev => RS.copy(curl(), ev.currentTarget));

        root.querySelectorAll('tr[data-id]').forEach(tr => {
          const k = keys.find(x => x.id === tr.dataset.id);
          tr.querySelector('[data-act="credit"]')?.addEventListener('click', () => openCredit(k));
          tr.querySelector('[data-act="edit"]')?.addEventListener('click', () => openEdit(k));
          tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
            const ok = await RS.confirmDialog({ title: '删除密钥', message: `删除「${k.name}」后，使用该密钥的客户端会立即收到 401。`, danger: true, confirmText: '删除' });
            if (!ok) return;
            await RS.api('keys/' + encodeURIComponent(k.id), { method: 'DELETE' });
            RS.toast('密钥已删除'); await load();
          });
          tr.querySelector('[data-toggle]').addEventListener('change', async ev => {
            const enabled = ev.target.checked;
            try {
              await RS.api('keys/' + encodeURIComponent(k.id), { method: 'PATCH', body: { enabled } });
              RS.toast(enabled ? '密钥已启用' : '密钥已停用');
              await load();
            } catch (err) { RS.toast(err.message, 'error'); ev.target.checked = !enabled; }
          });
        });
      }

      function keyRow(k, stat) {
        const customer = !!k.user_id;
        const total = (stat && stat.total) || { requests: 0, prompt_tokens: 0, completion_tokens: 0, failures: 0 };
        const tokens = Number(total.prompt_tokens || 0) + Number(total.completion_tokens || 0);
        return `<tr data-id="${RS.esc(k.id)}">
          <td><div class="strong">${RS.esc(k.name)}</div>
            <div class="muted-2 text-xs">创建于 ${RS.when(k.created_at)}</div></td>
          <td><span class="chip mono">${RS.esc(customer && k.suffix ? 'sk-••••' + k.suffix : k.key || 'sk-…')}</span></td>
          <td>${customer
            ? `<span class="badge badge-blue">客户账户</span><div class="muted-2 text-xs mono truncate" style="max-width:180px" title="${RS.esc(k.user_id)}">${RS.esc(k.user_email || k.owner_email || k.user_id)}</div>`
            : k.group_id ? (() => { const g = groups.find(x => x.id === k.group_id); return `<span class="badge badge-teal">${RS.esc(g ? g.name : '已删除分组')}</span>`; })() : '<span class="muted-2">运营密钥 · 不限模型</span>'}</td>
          <td class="num">
            ${customer
              ? `<div class="text-xs tabular">${units(k.portal_used_micro)} / ${Number(k.budget_micro) > 0 ? units(k.budget_micro) : '跟随账户额度'}</div><div class="muted-2 text-xs">额度单位 · 已用 / 预算</div>`
              : Number(k.quota_usd) > 0
              ? `<div class="text-xs tabular">$${RS.fmtMoney(k.used_usd || 0)} / $${RS.fmtMoney(k.quota_usd)}</div>
                 <div class="progress mt-1" style="width:74px;margin-left:auto"><i style="width:${Math.min(100, (Number(k.used_usd || 0) / Number(k.quota_usd)) * 100)}%"></i></div>`
              : `<span class="muted">不限</span>`}
          </td>
          <td class="num mono">${k.rpm ? k.rpm : '不限'}</td>
          <td class="num tabular">${RS.num(total.requests)}${total.failures ? `<span class="muted-2"> · 失败 ${RS.num(total.failures)}</span>` : ''}</td>
          <td class="num tabular">${RS.fmt(tokens)}</td>
          <td class="muted">${k.last_used_at ? RS.ago(k.last_used_at) : '从未'}</td>
          <td>
            <label class="switch" title="启用 / 停用">
              <input type="checkbox" data-toggle ${k.enabled !== false ? 'checked' : ''}><span></span>
            </label>
          </td>
          <td class="num">
            <div class="inline-flex gap-1" style="justify-content:flex-end">
              ${customer
                ? `<a class="btn btn-secondary btn-sm" href="#/customers">管理账户</a>`
                : `<button class="btn btn-secondary btn-sm" data-act="credit" title="加额度">${RS.icon('wallet')}</button><button class="btn btn-secondary btn-sm" data-act="edit" title="编辑">${RS.icon('edit')}</button>`}
              <button class="btn btn-danger btn-sm" data-act="del" title="删除">${RS.icon('trash')}</button>
            </div>
          </td>
        </tr>`;
      }

      function units(micro) {
        return (Number(micro || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
      }
      function apiBase() {
        return location.origin + location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '') + '/v1';
      }
      function curl() {
        return `curl ${apiBase()}/chat/completions \\
  -H "Authorization: Bearer sk-relay-***" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"你好"}]}'`;
      }

      function openCreate() {
        const m = RS.modal({
          title: '生成 API 密钥',
          sub: '明文只在创建后显示一次，请立即保存',
          body: `
            <div class="field"><label class="input-label">名称</label>
              <input class="input" id="kName" placeholder="例如 客户端 / 手机"><p class="input-hint">用于在日志与用量里区分调用方。</p></div>
            <div class="field"><label class="input-label">RPM 限速</label>
              <input class="input" id="kRpm" type="number" min="0" value="0" placeholder="0 表示不限制">
              <p class="input-hint">每分钟最多请求数；0 表示不限制。</p></div>
            <div class="grid grid-cols-2 gap-4">
              <div class="field"><label class="input-label">所属分组</label>
                <select class="select" id="kGroup"><option value="">不限模型</option>${groups.map(g => `<option value="${RS.esc(g.id)}">${RS.esc(g.name)}</option>`).join('')}</select>
                <p class="input-hint">分组限制可用模型范围。</p></div>
              <div class="field"><label class="input-label">额度上限（元）</label>
                <input class="input" id="kQuota" type="number" min="0" step="0.01" value="0" placeholder="0 表示不限">
                <p class="input-hint">按单价累计，用完后返回 402。</p></div>
            </div>
            <p class="field-error" id="kErr"></p>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" id="kSave">${RS.icon('plus')} 生成</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#kSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 生成中…';
          try {
            const created = await RS.api('keys', { method: 'POST', body: { name: m.querySelector('#kName').value.trim() || 'API key', rpm: Math.max(0, Number(m.querySelector('#kRpm').value) || 0), group_id: m.querySelector('#kGroup').value || null, quota_usd: Math.max(0, Number(m.querySelector('#kQuota').value) || 0) } });
            showSecret(created);
            await load();
          } catch (err) {
            m.querySelector('#kErr').textContent = err.message;
            btn.disabled = false; btn.innerHTML = RS.icon('plus') + ' 生成';
          }
        });
      }

      function showSecret(created) {
        const m = RS.modal({
          title: '密钥已生成',
          sub: '复制后妥善保存，关闭后无法再次查看',
          body: `
            <div class="field"><label class="input-label">${RS.esc(created.name)}</label>
              <div class="code-block" id="secretText">${RS.esc(created.key)}</div>
            </div>
            <div class="flex items-center gap-2 text-xs" style="color:#b45309">
              ${RS.icon('alert')} 该密钥拥有调用全部已启用模型的权限，泄露后请立即删除。
            </div>`,
          footer: `<button class="btn btn-secondary" data-cancel>关闭</button>
                   <button class="btn btn-primary" id="copySecret">${RS.icon('copy')} 复制密钥</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#copySecret').addEventListener('click', ev => RS.copy(created.key, ev.currentTarget));
      }

      function openEdit(k) {
        const m = RS.modal({
          title: '编辑密钥',
          body: `<div class="field"><label class="input-label">名称</label><input class="input" id="eName" value="${RS.esc(k.name)}"></div>
                 <div class="field"><label class="input-label">RPM 限速</label><input class="input" id="eRpm" type="number" min="0" value="${k.rpm || 0}"></div>
                 <div class="grid grid-cols-2 gap-4">
                   <div class="field"><label class="input-label">所属分组</label>
                     <select class="select" id="eGroup"><option value="">不限模型</option>${groups.map(g => `<option value="${RS.esc(g.id)}"${k.group_id === g.id ? ' selected' : ''}>${RS.esc(g.name)}</option>`).join('')}</select></div>
                   <div class="field"><label class="input-label">额度上限（元）</label>
                     <input class="input" id="eQuota" type="number" min="0" step="0.01" value="${Number(k.quota_usd) || 0}"></div>
                 </div>
                 <p class="input-hint">已用 $${RS.fmtMoney(k.used_usd || 0)}（美元等值）；把上限改大等于加额度，改为 0 等于不限。</p>
                 <p class="field-error" id="eErr"></p>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" id="eSave">保存</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#eSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget; btn.disabled = true;
          try {
            await RS.api('keys/' + encodeURIComponent(k.id), { method: 'PATCH', body: { name: m.querySelector('#eName').value.trim() || k.name, rpm: Math.max(0, Number(m.querySelector('#eRpm').value) || 0), group_id: m.querySelector('#eGroup').value || null, quota_usd: Math.max(0, Number(m.querySelector('#eQuota').value) || 0) } });
            RS.closeModal(); RS.toast('密钥已更新'); await load();
          } catch (err) { m.querySelector('#eErr').textContent = err.message; btn.disabled = false; }
        });
      }

      function openCredit(k) {
        const m = RS.modal({
          title: '给密钥加额度（USD 等值）',
          sub: k.name,
          body: `
            <div class="field"><label class="input-label">加多少（美元等值 USD）</label>
              <input class="input" id="cAmount" type="number" min="0" step="0.01" value="10">
              <p class="input-hint">当前已用 $${RS.fmtMoney(k.used_usd || 0)}，上限 ${Number(k.quota_usd) > 0 ? '$' + RS.fmtMoney(k.quota_usd) : '不限'}。加额度 = 上限 + 金额；1 USD 记 1,000,000 micro-credits，不会变成 500000。</p></div>
            <p class="field-error" id="cErr"></p>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" id="cSave">${RS.icon('wallet')} 确认加额度</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#cSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 处理中…';
          try {
            await RS.api('keys/' + encodeURIComponent(k.id) + '/credit', { method: 'POST', body: { amount: Number(m.querySelector('#cAmount').value) || 0 } });
            RS.closeModal(); RS.toast('额度已增加'); await load();
          } catch (err) { m.querySelector('#cErr').textContent = err.message; btn.disabled = false; btn.innerHTML = RS.icon('wallet') + ' 确认加额度'; }
        });
      }

      await load();
      ctx.poll(load, 20000);
    }
  };
})();
