/* 模型广场 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.models = {
    title: '模型广场',
    sub: '模型、单价与渠道配置',
    icon: 'layers',
    async mount(root, ctx) {
      const RS = window.RS;
      let q = '';
      let sort = 'requests';
      let data = null;

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 汇总模型…</div></div>`;

      async function load() {
        data = await RS.api('models');
        render();
      }

      function render() {
        const items = (data.items || []).filter(m => !q || m.model.toLowerCase().includes(q.toLowerCase()));
        const sorted = [...items].sort((a, b) => sort === 'name' ? a.model.localeCompare(b.model) : sort === 'tokens' ? (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens) : b.requests - a.requests);
        const priced = (data.items || []).filter(m => m.pricing).length;
        const usable = (data.items || []).filter(m => m.enabled_channels > 0).length;

        root.innerHTML = `
        <div class="page-stack">
          <div class="grid grid-cols-4 gap-4">
            <div class="card stat-card"><div class="stat-icon blue">${RS.icon('layers')}</div>
              <div><div class="stat-label">模型总数</div><div class="stat-value">${(data.items || []).length}</div>
              <div class="stat-hint">已配置单价 ${priced} 个</div></div></div>
            <div class="card stat-card"><div class="stat-icon green">${RS.icon('checkCircle')}</div>
              <div><div class="stat-label">有启用渠道</div><div class="stat-value">${usable}</div>
              <div class="stat-hint">配置状态，不代表健康检查结果</div></div></div>
            <div class="card stat-card"><div class="stat-icon amber">${RS.icon('wallet')}</div>
              <div><div class="stat-label">已定价</div><div class="stat-value">${priced}</div>
              <div class="stat-hint">未定价时客户调用暂停</div></div></div>
            <div class="card stat-card"><div class="stat-icon violet">${RS.icon('activity')}</div>
              <div><div class="stat-label">24h 请求</div><div class="stat-value">${RS.num((data.items || []).reduce((a, m) => a + m.requests, 0))}</div>
              <div class="stat-hint">全部模型合计</div></div></div>
          </div>

          <section class="card">
            <div class="card-header">
              <div><div class="card-title">模型列表</div><div class="card-sub">点击复制调用命令</div></div>
              <div class="toolbar">
                <div style="position:relative">
                  <input class="input" id="mSearch" placeholder="搜索模型" value="${RS.esc(q)}" style="padding-left:34px;min-width:200px">
                  <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted-2);width:15px;height:15px">${RS.icon('search')}</span>
                </div>
                <div class="segmented" id="mSort">
                  <button data-sort="requests" class="${sort === 'requests' ? 'active' : ''}">按调用</button>
                  <button data-sort="tokens" class="${sort === 'tokens' ? 'active' : ''}">按 Token</button>
                  <button data-sort="name" class="${sort === 'name' ? 'active' : ''}">按名称</button>
                </div>
              </div>
            </div>
            <div class="card-body">
              ${sorted.length ? `<div class="grid grid-cols-3 gap-3">${sorted.map(card).join('')}</div>`
                : `<div class="empty">${RS.icon('layers')}<b>没有模型</b><span>先在渠道里填写模型列表，这里会自动聚合。</span></div>`}
            </div>
          </section>
        </div>`;

        const search = root.querySelector('#mSearch');
        search.addEventListener('input', () => { q = search.value; render(); const el = root.querySelector('#mSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
        root.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { sort = b.dataset.sort; render(); }));
        root.querySelectorAll('[data-copy-model]').forEach(b => b.addEventListener('click', ev => {
          const model = b.dataset.copyModel;
          RS.copy(`curl ${apiBase()}/chat/completions -H "Authorization: Bearer sk-relay-***" -H "Content-Type: application/json" -d '{"model":"${model}","messages":[{"role":"user","content":"你好"}]}'`, ev.currentTarget);
        }));
      }

      function card(m) {
        const total = m.input_tokens + m.output_tokens + m.cache_read_tokens;
        const share = data.items.reduce((a, x) => a + x.requests, 0) ? (m.requests / data.items.reduce((a, x) => a + x.requests, 0)) * 100 : 0;
        const ok = m.enabled_channels > 0;
        const price = m.pricing ? `${RS.esc(m.pricing.in)} / ${RS.esc(m.pricing.out)}` : '未发布单价';
        return `<div class="card hover" style="padding:16px;box-shadow:none;background:var(--surface-2);border-color:transparent">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="strong truncate" title="${RS.esc(m.model)}" style="font-size:13.5px">${RS.esc(m.model)}</div>
              <div class="muted-2 text-xs mt-1">${m.channels.length} 条渠道 · ${m.enabled_channels} 已启用</div>
            </div>
            <span class="badge ${ok ? 'badge-green' : 'badge-gray'}"><i class="dot"></i>${ok ? '渠道已启用' : '无启用渠道'}</span>
          </div>
          <div class="mt-3">
            <div class="flex items-center justify-between text-xs muted mb-1">
              <span>24h 调用 ${RS.num(m.requests)}</span><span>${share.toFixed(1)}%</span>
            </div>
            <div class="progress"><i style="width:${Math.min(100, share * 2)}%"></i></div>
          </div>
          <div class="flex items-center justify-between mt-3 text-xs">
            <span class="muted">输入 / 输出（额度单位 / 1M Token）</span>
            <span class="${m.pricing ? 'strong' : 'muted-2'}">${price}</span>
          </div>
          <div class="flex items-center justify-between mt-1 text-xs">
            <span class="muted">Token</span><span class="tabular">${RS.fmt(total)}</span>
          </div>
          <div class="flex gap-2 mt-3">
            <button class="btn btn-secondary btn-sm flex-1" data-copy-model="${RS.esc(m.model)}">${RS.icon('copy')} 复制调用</button>
            <a class="btn btn-ghost btn-sm" href="#/channels">${RS.icon('server')}</a>
          </div>
        </div>`;
      }

      function apiBase() {
        return location.origin + location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '') + '/v1';
      }

      await load();
      ctx.poll(load, 30000);
    }
  };
})();
