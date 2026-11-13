/* 兑换码 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.redeem = {
    title: '兑换码',
    sub: '发卡给客户，兑换后加额度',
    icon: 'wallet',
    async mount(root, ctx) {
      const RS = window.RS;
      let items = [];

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取兑换码…</div></div>`;

      async function load() {
        items = (await RS.api('redeem')) || [];
        render();
      }

      function render() {
        const unused = items.filter(i => !i.used);
        const total = items.reduce((a, i) => a + Number(i.amount || 0), 0);
        const usedAmount = items.filter(i => i.used).reduce((a, i) => a + Number(i.amount || 0), 0);
        root.innerHTML = `
        <div class="page-stack">
          <div class="grid grid-cols-4 gap-4">
            <div class="card stat-card"><div class="stat-icon blue">${RS.icon('wallet')}</div><div><div class="stat-label">面额合计</div><div class="stat-value">¥${RS.fmtMoney(total)}</div><div class="stat-hint">共 ${items.length} 张</div></div></div>
            <div class="card stat-card"><div class="stat-icon amber">${RS.icon('clock')}</div><div><div class="stat-label">未兑换</div><div class="stat-value">${unused.length}</div><div class="stat-hint">可以随时发给客户</div></div></div>
            <div class="card stat-card"><div class="stat-icon green">${RS.icon('checkCircle')}</div><div><div class="stat-label">已兑换</div><div class="stat-value">${items.length - unused.length}</div><div class="stat-hint">¥${RS.fmtMoney(usedAmount)}</div></div></div>
            <div class="card stat-card"><div class="stat-icon violet">${RS.icon('zap')}</div><div><div class="stat-label">兑换方式</div><div class="stat-value" style="font-size:15px">POST /v1/redeem</div><div class="stat-hint mono">Bearer API Key</div></div></div>
          </div>

          <section class="card">
            <div class="card-header">
              <div><div class="card-title">兑换码列表</div><div class="card-sub">每张只能兑换一次，额度直接加到密钥</div></div>
              <div class="toolbar">
                <button class="btn btn-secondary btn-sm" id="copyUnused">${RS.icon('copy')} 复制未用码</button>
                <button class="btn btn-primary btn-sm" id="newCode">${RS.icon('plus')} 生成兑换码</button>
              </div>
            </div>
            <div class="card-body flush">
              ${items.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>兑换码</th><th class="num">面额</th><th>有效期</th><th>状态</th><th>使用者</th><th>兑换时间</th><th class="num">操作</th></tr></thead>
                <tbody>${items.map(i => `<tr data-id="${RS.esc(i.id)}">
                  <td><span class="chip mono">${RS.esc(i.code)}</span></td>
                  <td class="num tabular">¥${RS.fmtMoney(i.amount)}</td>
                  <td class="muted">${i.expires_at ? RS.when(i.expires_at) : '长期'}</td>
                  <td>${i.used ? '<span class="badge badge-gray">已使用</span>' : '<span class="badge badge-green"><i class="dot"></i>可用</span>'}</td>
                  <td class="muted">${RS.esc(i.used_by || '—')}</td>
                  <td class="muted mono">${i.used_at ? RS.when(i.used_at) : '—'}</td>
                  <td class="num"><div class="inline-flex gap-1" style="justify-content:flex-end">
                    ${!i.used ? `<button class="btn btn-secondary btn-sm" data-copy="${RS.esc(i.code)}">${RS.icon('copy')}</button>` : ''}
                    <button class="btn btn-danger btn-sm" data-act="del">${RS.icon('trash')}</button>
                  </div></td>
                </tr>`).join('')}</tbody></table></div>`
                : `<div class="empty">${RS.icon('wallet')}<b>还没有兑换码</b><span>生成一批，发给客户后他们用 /v1/redeem 兑换，额度自动到账。</span></div>`}
            </div>
          </section>
        </div>`;

        root.querySelector('#newCode').addEventListener('click', openCreate);
        root.querySelector('#copyUnused').addEventListener('click', ev => {
          if (!unused.length) return RS.toast('没有未使用的兑换码', 'error');
          RS.copy(unused.map(i => `${i.code}\t¥${i.amount}`).join('\n'), ev.currentTarget);
        });
        root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', ev => RS.copy(b.dataset.copy, ev.currentTarget)));
        root.querySelectorAll('tr[data-id]').forEach(tr => tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
          const ok = await RS.confirmDialog({ title: '删除兑换码', message: '删除后该码立即失效。', danger: true, confirmText: '删除' });
          if (!ok) return;
          await RS.api('redeem/' + encodeURIComponent(tr.dataset.id), { method: 'DELETE' });
          RS.toast('已删除'); await load();
        }));
      }

      function openCreate() {
        const m = RS.modal({
          title: '生成兑换码',
          body: `
            <div class="grid grid-cols-2 gap-4">
              <div class="field"><label class="input-label">数量</label><input class="input" id="rCount" type="number" min="1" max="200" value="5"></div>
              <div class="field"><label class="input-label">面额（元）</label><input class="input" id="rAmount" type="number" min="0" step="0.01" value="10"></div>
            </div>
            <div class="field"><label class="input-label">备注</label><input class="input" id="rNote" placeholder="例如 10 月推广"></div>
            <p class="input-hint">兑换后额度会累加到该密钥的额度上限（0 表示不限）。</p>
            <p class="field-error" id="rErr"></p>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" id="rSave">${RS.icon('zap')} 生成</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#rSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 生成中…';
          try {
            const created = await RS.api('redeem', { method: 'POST', body: { count: Number(m.querySelector('#rCount').value) || 1, amount: Number(m.querySelector('#rAmount').value) || 0, note: m.querySelector('#rNote').value.trim() } });
            RS.closeModal();
            await load();
            const m2 = RS.modal({
              title: `已生成 ${created.length} 张`,
              sub: '复制后发给客户，关闭后仍可在列表里复制',
              body: `<div class="code-block" style="max-height:320px;overflow:auto">${created.map(c => `${c.code}\t¥${c.amount}`).join('\n')}</div>`,
              footer: `<button class="btn btn-secondary" data-cancel>关闭</button><button class="btn btn-primary" id="copyAll">${RS.icon('copy')} 复制全部</button>`
            });
            m2.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
            m2.querySelector('#copyAll').addEventListener('click', ev2 => RS.copy(created.map(c => c.code).join('\n'), ev2.currentTarget));
          } catch (err) { m.querySelector('#rErr').textContent = err.message; btn.disabled = false; btn.innerHTML = RS.icon('zap') + ' 生成'; }
        });
      }

      await load();
      ctx.poll(async () => { await load(); }, 30000);
    }
  };
})();
