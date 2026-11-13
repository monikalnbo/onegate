/* 使用记录 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.usage = {
    title: '使用记录',
    sub: '逐条请求的用量与消费',
    icon: 'activity',
    async mount(root, ctx) {
      const RS = window.RS;
      let query = { q: '', model: '', key: '', status: '', limit: 20, offset: 0 };
      let last = null;

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取记录…</div></div>`;

      async function load() {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
        last = await RS.api('usage?' + qs.toString());
        render();
      }

      function render() {
        const data = last;
        const items = data.items || [];
        const pages = Math.max(1, Math.ceil(data.total / data.limit));
        const page = Math.floor(data.offset / data.limit) + 1;

        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div>
                <div class="card-title">请求明细</div>
                <div class="card-sub">共 ${RS.num(data.total)} 条记录 · 合计消费 ¥${RS.fmtMoney(data.revenue)}</div>
              </div>
              <div class="toolbar">
                <div style="position:relative">
                  <input class="input" id="uSearch" placeholder="搜索模型 / 渠道 / 密钥" value="${RS.esc(query.q)}" style="padding-left:34px;min-width:210px">
                  <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted-2);width:15px;height:15px">${RS.icon('search')}</span>
                </div>
                <select class="select" id="uModel">
                  <option value="">全部模型</option>
                  ${(data.models || []).map(m => `<option value="${RS.esc(m)}"${query.model === m ? ' selected' : ''}>${RS.esc(m)}</option>`).join('')}
                </select>
                <select class="select" id="uKey">
                  <option value="">全部密钥</option>
                  ${(data.keys || []).map(k => `<option value="${RS.esc(k)}"${query.key === k ? ' selected' : ''}>${RS.esc(k)}</option>`).join('')}
                </select>
                <select class="select" id="uStatus">
                  <option value="">全部状态</option>
                  <option value="ok"${query.status === 'ok' ? ' selected' : ''}>成功</option>
                  <option value="error"${query.status === 'error' ? ' selected' : ''}>失败</option>
                </select>
              </div>
            </div>
            <div class="card-body flush">
              ${items.length ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>时间</th><th>密钥</th><th>模型</th><th>渠道</th><th class="num">状态</th>
                  <th class="num">耗时</th><th class="num">输入</th><th class="num">输出</th><th class="num">消费</th>
                </tr></thead>
                <tbody>${items.map(row).join('')}</tbody>
              </table></div>`
              : `<div class="empty">${RS.icon('activity')}<b>没有匹配的记录</b><span>调整筛选条件，或先发起一次调用。</span></div>`}
            </div>
            <div class="card-footer">
              <div class="flex items-center justify-between">
                <div class="text-xs muted">第 ${page} / ${pages} 页 · 每页 ${data.limit} 条</div>
                <div class="inline-flex gap-1">
                  <button class="btn btn-secondary btn-sm" data-page="prev" ${data.offset === 0 ? 'disabled' : ''}>上一页</button>
                  <button class="btn btn-secondary btn-sm" data-page="next" ${data.offset + data.limit >= data.total ? 'disabled' : ''}>下一页</button>
                </div>
              </div>
            </div>
          </section>
        </div>`;

        const search = root.querySelector('#uSearch');
        search.addEventListener('input', () => {
          query.q = search.value; query.offset = 0;
          clearTimeout(search._t);
          search._t = setTimeout(async () => { await load(); const el = root.querySelector('#uSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 260);
        });
        root.querySelector('#uModel').addEventListener('change', ev => { query.model = ev.target.value; query.offset = 0; load(); });
        root.querySelector('#uKey').addEventListener('change', ev => { query.key = ev.target.value; query.offset = 0; load(); });
        root.querySelector('#uStatus').addEventListener('change', ev => { query.status = ev.target.value; query.offset = 0; load(); });
        root.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', async () => {
          query.offset = Math.max(0, b.dataset.page === 'next' ? query.offset + data.limit : query.offset - data.limit);
          await load();
        }));
      }

      function row(it) {
        return `<tr>
          <td class="mono muted">${RS.when(it.ts)}</td>
          <td class="truncate" style="max-width:120px">${RS.esc(it.key_name || '—')}</td>
          <td class="truncate strong" style="max-width:170px">${RS.esc(it.model || '—')}${it.stream ? ' <span class="badge badge-blue" style="font-size:10px">stream</span>' : ''}</td>
          <td class="truncate" style="max-width:120px">${RS.esc(it.channel_name || '—')}</td>
          <td class="num">${RS.statusBadge(it.status)}</td>
          <td class="num mono">${it.latency_ms ? RS.num(it.latency_ms) + ' ms' : '—'}</td>
          <td class="num tabular">${RS.num(it.prompt_tokens)}</td>
          <td class="num tabular">${RS.num(it.completion_tokens)}</td>
          <td class="num tabular">${it.cost ? '¥' + RS.fmtMoney(it.cost) : '—'}</td>
        </tr>`;
      }

      await load();
      ctx.poll(async () => { if (!query.q) await load(); }, 20000);
    }
  };
})();
