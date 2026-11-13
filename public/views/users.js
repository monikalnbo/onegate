/* 用户信息：余额、分组、密钥额度、注册时间、状态、最后活跃 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.users = {
    title: '用户信息',
    sub: '账户余额、分组、密钥额度与活跃状态；加额与分组分配都在这里',
    icon: 'users',
    async mount(root, ctx) {
      const RS = window.RS;
      let users = [], groups = [];

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取用户…</div></div>`;

      async function load() {
        const res = await RS.api('users');
        users = Array.isArray(res) ? res : (res.items || []);
        groups = (res && res.groups) || [];
        render();
      }

      function usd(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }); }
      function stamp(ts) { return ts ? RS.when(ts) : '从未'; }

      function groupName(id) { const g = groups.find(x => x.id === id); return g ? g.name : '—'; }

      function render() {
        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div><div class="card-title">账户列表</div><div class="card-sub">共 ${users.length} 个 · 余额单位 USD 等值（内部 micro-credits，1 USD = 1,000,000）</div></div>
              <div class="toolbar"><button class="btn btn-secondary btn-sm" id="uRefresh">${RS.icon('refresh')} 刷新</button></div>
            </div>
            <div class="card-body flush">
              ${users.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>邮箱</th><th>邮箱验证</th><th class="num">余额</th><th class="num">累计消费</th><th>分组</th><th>注册时间</th><th>账号状态</th><th>最后活跃</th><th class="num">操作</th></tr></thead>
                <tbody>${users.map(u => `<tr>
                  <td class="strong truncate" style="max-width:200px">${RS.esc(u.email)}</td>
                  <td>${u.verified ? '<span class="badge badge-green">已验证</span>' : '<span class="badge badge-amber">待验证</span>'}</td>
                  <td class="num mono">${usd(u.balance)}</td>
                  <td class="num mono">${usd(u.spent)}</td>
                  <td>${u.group_id ? `<span class="chip">${RS.esc(groupName(u.group_id))}</span>` : '<span class="muted-2">未分组</span>'}</td>
                  <td class="mono text-xs">${stamp(u.created_at)}</td>
                  <td>${u.disabled ? '<span class="badge badge-gray">已停用</span>' : '<span class="badge badge-green">可用</span>'}</td>
                  <td class="muted text-xs">${stamp(u.last_active_at)}</td>
                  <td class="num"><div class="inline-flex gap-1" style="justify-content:flex-end">
                    <button class="btn btn-secondary btn-sm" data-detail="${RS.esc(u.id)}">详情</button>
                    <button class="btn btn-primary btn-sm" data-credit="${RS.esc(u.id)}">${RS.icon('wallet')} 加额</button>
                  </div></td>
                </tr>`).join('')}</tbody></table></div>`
                : `<div class="empty">${RS.icon('users')}<b>还没有账户</b><span>用户在主站注册并验证邮箱后会出现在这里。</span></div>`}
            </div>
          </section>
        </div>`;

        root.querySelector('#uRefresh').addEventListener('click', load);
        root.querySelectorAll('[data-credit]').forEach(b => b.addEventListener('click', () => openCredit(users.find(u => u.id === b.dataset.credit))));
        root.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => openDetail(b.dataset.detail)));
      }

      async function openDetail(id) {
        const detail = await RS.api('users/' + encodeURIComponent(id));
        const u = detail.user || {};
        const keys = detail.keys || [];
        const options = detail.group_options || groups;
        const rate = u.group_id ? (options.find(g => g.id === u.group_id) || {}).rate_multiplier : null;
        const m = RS.modal({
          title: '用户详情',
          sub: u.email || '',
          wide: true,
          body: `
            <div class="grid grid-cols-3 gap-3" style="margin-bottom:14px">
              <div class="stat-card" style="padding:12px"><div class="stat-label">可用余额</div><div class="stat-value small mono">${usd(u.balance)}</div></div>
              <div class="stat-card" style="padding:12px"><div class="stat-label">累计消费</div><div class="stat-value small mono">${usd(u.spent)}</div></div>
              <div class="stat-card" style="padding:12px"><div class="stat-label">最后活跃</div><div class="stat-value small">${stamp(u.last_active_at)}</div></div>
            </div>
            <div class="field"><label class="input-label">所属分组（影响可用模型与计费倍率）</label>
              <div class="inline-flex gap-2" style="width:100%">
                <select class="input" id="dGroup" style="flex:1">
                  <option value="">未分组（不限模型、倍率 1）</option>
                  ${options.map(g => `<option value="${RS.esc(g.id)}" ${u.group_id === g.id ? 'selected' : ''}>${RS.esc(g.name)} · 倍率 ${Number(g.rate_multiplier || 1)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary" id="dSaveGroup">保存</button>
              </div>
              ${rate != null ? `<p class="input-hint">当前计费倍率 ${rate}：模型单价 × ${rate} 后从余额扣费。</p>` : ''}
            </div>
            <div class="field"><label class="input-label">API 密钥（${keys.length}）</label>
              ${keys.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>名称</th><th>标识</th><th>状态</th><th class="num">额度上限</th><th class="num">已用</th><th>创建时间</th></tr></thead>
                <tbody>${keys.map(k => `<tr>
                  <td class="truncate" style="max-width:140px">${RS.esc(k.name)}</td>
                  <td class="mono text-xs">${k.suffix ? 'sk-…' + RS.esc(k.suffix) : '—'}</td>
                  <td>${k.revoked_at ? '<span class="badge badge-gray">已吊销</span>' : k.enabled === false ? '<span class="badge badge-amber">已停用</span>' : '<span class="badge badge-green">可用</span>'}</td>
                  <td class="num mono">${Number(k.quota_usd) > 0 ? usd(k.quota_usd) : '按账户余额'}</td>
                  <td class="num mono">${usd(k.used_usd)}</td>
                  <td class="mono text-xs">${stamp(k.created_at)}</td>
                </tr>`).join('')}</tbody></table></div>`
                : '<p class="input-hint">该用户还没有创建密钥。</p>'}
            </div>
            <p class="field-error" id="dErr"></p>`,
          footer: '<button class="btn btn-secondary" data-cancel>关闭</button>'
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#dSaveGroup').addEventListener('click', async ev => {
          const btn = ev.currentTarget; btn.disabled = true;
          try {
            await RS.api('users/' + encodeURIComponent(id), { method: 'PATCH', body: { group_id: m.querySelector('#dGroup').value || null } });
            RS.closeModal(); RS.toast('分组已更新'); await load();
          } catch (err) { m.querySelector('#dErr').textContent = err.message; btn.disabled = false; }
        });
      }

      function openCredit(u) {
        if (!u) return;
        const m = RS.modal({
          title: '给用户加额度',
          sub: u.email,
          body: `
            <form id="uCreditForm">
              <div class="grid grid-cols-2 gap-3">
                <div class="field"><label class="input-label">加之前余额（USD）</label><input class="input mono" value="${Number(u.balance || 0).toFixed(6)}" disabled></div>
                <div class="field"><label class="input-label">本次增加（USD）</label><input class="input" id="uAmount" name="amount" type="number" min="0.000001" max="100000" step="0.000001" value="1" required></div>
              </div>
              <p class="input-hint">1 USD = 1,000,000 micro-credits（内部计费单位）。加 1 美元 = 内部 +1,000,000，页面显示 +$1.00，不会变成 500000 这类数字。</p>
              <div class="field"><label class="input-label">备注（写入审计）</label><input class="input" id="uNote" name="note" maxlength="180" required placeholder="例如：线下转账 / 补偿"></div>
              <p class="field-error" id="uErr" role="alert"></p>
            </form>`,
          footer: '<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" type="submit" form="uCreditForm">确认加额</button>'
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('form').addEventListener('submit', async event => {
          event.preventDefault();
          if (event.target.dataset.busy === 'true') return;
          event.target.dataset.busy = 'true';
          const f = new FormData(event.target); const btn = m.querySelector('[type=submit]'); btn.disabled = true;
          try {
            const res = await RS.api('users/' + encodeURIComponent(u.id) + '/credit', { method: 'POST', body: { amount: Number(f.get('amount')), note: String(f.get('note')), reference: crypto.randomUUID() } });
            RS.closeModal();
            RS.toast(`已加 $${Number(res.added || 0).toFixed(6)}：${Number(res.before || 0).toFixed(6)} → ${Number(res.after || 0).toFixed(6)}`);
            await load();
          } catch (err) { m.querySelector('#uErr').textContent = err.message; event.target.dataset.busy = 'false'; btn.disabled = false; }
        });
      }

      await load();
    }
  };
})();
