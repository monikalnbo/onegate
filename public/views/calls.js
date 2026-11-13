/* 调用记录（结构化埋点） */
(function () {
  'use strict';
  const V = window.RSViews;

  V.calls = {
    title: '调用记录',
    sub: '按时间 / 用户 / 密钥 / 模型 / 状态查询每次调用的明细与费用',
    icon: 'filter',
    async mount(root, ctx) {
      const RS = window.RS;
      const pageSize = 50;
      const filters = { from: '', to: '', user: '', key: '', model: '', source: '', channel: '', status: '', q: '' };
      let offset = 0, data = null, meta = null;

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取调用记录…</div></div>`;

      async function load() {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
        params.set('limit', String(pageSize)); params.set('offset', String(offset));
        const [res, m] = await Promise.all([RS.api('calls?' + params.toString()), meta ? Promise.resolve(meta) : RS.api('calls/meta')]);
        data = res; meta = m;
        render();
      }

      function usd(n) { return '$' + Number(n || 0).toFixed(6).replace(/0{2,}$/, (m) => m.length > 3 ? m.slice(0, -2) : m); }
      function num(n) { return Number(n || 0).toLocaleString('en-US'); }

      function stamp(ts) {
        if (!ts) return '—';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return String(ts);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }

      function localInput(d) {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      }

      function render() {
        const items = (data && data.items) || [];
        const totals = (data && data.totals) || {};
        const facets = meta || {};
        const total = (data && data.total) || 0;
        const page = Math.floor(offset / pageSize) + 1;
        const pages = Math.max(1, Math.ceil(total / pageSize));

        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div>
                <div class="card-title">查询条件</div>
                <div class="card-sub">留空即不限；只记录密钥掩码、不记录完整 key。保留 ${facets.retention_days || 90} 天，当前 ${num((facets.rows || 0))} 条。</div>
              </div>
              <div class="toolbar">
                <button class="btn btn-secondary btn-sm" id="cToday">今天</button>
                <button class="btn btn-secondary btn-sm" id="c24">近 24 小时</button>
                <button class="btn btn-secondary btn-sm" id="cReset">清空条件</button>
                <button class="btn btn-primary btn-sm" id="cSearch">${RS.icon('search')} 查询</button>
              </div>
            </div>
            <div class="card-body">
              <div class="grid grid-cols-4 gap-3">
                <div class="field"><label class="input-label" for="fFrom">开始时间</label><input class="input" id="fFrom" type="datetime-local" value="${RS.esc(filters.from ? localInput(new Date(filters.from)) : '')}"></div>
                <div class="field"><label class="input-label" for="fTo">结束时间</label><input class="input" id="fTo" type="datetime-local" value="${RS.esc(filters.to ? localInput(new Date(filters.to)) : '')}"></div>
                <div class="field"><label class="input-label" for="fStatus">状态</label><select class="input" id="fStatus">
                  <option value="">全部</option><option value="ok" ${filters.status === 'ok' ? 'selected' : ''}>成功（2xx/3xx）</option><option value="error" ${filters.status === 'error' ? 'selected' : ''}>失败（4xx/5xx）</option>
                </select></div>
                <div class="field"><label class="input-label" for="fModel">模型</label><select class="input" id="fModel">
                  <option value="">全部</option>${(facets.models || []).map(m => `<option value="${RS.esc(m)}" ${filters.model === m ? 'selected' : ''}>${RS.esc(m)}</option>`).join('')}
                </select></div>
                <div class="field"><label class="input-label" for="fUser">用户</label><select class="input" id="fUser">
                  <option value="">全部</option>${(facets.users || []).map(u => `<option value="${RS.esc(u)}" ${filters.user === u ? 'selected' : ''}>${RS.esc(u)}</option>`).join('')}
                </select></div>
                <div class="field"><label class="input-label" for="fKey">密钥</label><select class="input" id="fKey">
                  <option value="">全部</option>${(facets.keys || []).map(k => `<option value="${RS.esc(k.id)}" ${filters.key === k.id ? 'selected' : ''}>${RS.esc(k.label)}（${RS.esc(k.hint || '—')}）</option>`).join('')}
                </select></div>
                <div class="field"><label class="input-label" for="fSource">模型来源</label><select class="input" id="fSource">
                  <option value="">全部</option>${(facets.source_groups || []).map(g => `<option value="${RS.esc(g.id)}" ${filters.source === g.id ? 'selected' : ''}>${RS.esc(g.name)}</option>`).join('')}
                </select></div>
                <div class="field"><label class="input-label" for="fChannel">渠道</label><select class="input" id="fChannel">
                  <option value="">全部</option>${(facets.channels || []).map(c => `<option value="${RS.esc(c.id)}" ${filters.channel === c.id ? 'selected' : ''}>${RS.esc(c.name)}</option>`).join('')}
                </select></div>
                <div class="field"><label class="input-label" for="fQ">搜索</label><input class="input" id="fQ" placeholder="request_id / 渠道 / 来源分组 / 错误 / IP" value="${RS.esc(filters.q)}"></div>
              </div>
            </div>
          </section>

          <div class="grid grid-cols-4 gap-4">
            ${stat('请求数', num(totals.requests || 0), (totals.errors || 0) + ' 次失败')}
            ${stat('Tokens', num(totals.total_tokens || 0), '输入 ' + num(totals.prompt_tokens || 0) + ' · 输出 ' + num(totals.completion_tokens || 0))}
            ${stat('费用', '$' + Number(totals.cost || 0).toFixed(6), '按当前价格表折算')}
            ${stat('平均耗时', num(totals.avg_latency_ms || 0) + ' ms', '含排队与重试')}
          </div>

          <section class="card">
            <div class="card-header">
              <div><div class="card-title">调用明细</div><div class="card-sub">共 ${num(total)} 条 · 第 ${page} / ${pages} 页</div></div>
              <div class="toolbar">
                <button class="btn btn-secondary btn-sm" id="cPrev" ${offset <= 0 ? 'disabled' : ''}>上一页</button>
                <button class="btn btn-secondary btn-sm" id="cNextPage" ${offset + pageSize >= total ? 'disabled' : ''}>下一页</button>
              </div>
            </div>
            <div class="card-body flush">
              ${items.length ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>时间</th><th>用户 / 密钥</th><th>模型</th><th>渠道 / 来源</th>
                  <th class="num">输入</th><th class="num">输出</th><th class="num">费用</th>
                  <th class="num">耗时</th><th class="num">状态</th><th>错误</th><th>IP / UA</th>
                </tr></thead>
                <tbody>${items.map(row).join('')}</tbody>
              </table></div>`
                : `<div class="empty">${RS.icon('filter')}<b>没有匹配的调用</b><span>换个时间区间或清空条件再试。</span></div>`}
            </div>
          </section>
        </div>`;

        const read = () => {
          const v = id => root.querySelector(id).value;
          filters.from = v('#fFrom') ? new Date(v('#fFrom')).toISOString() : '';
          filters.to = v('#fTo') ? new Date(v('#fTo')).toISOString() : '';
          filters.status = v('#fStatus'); filters.model = v('#fModel'); filters.user = v('#fUser'); filters.key = v('#fKey'); filters.source = v('#fSource'); filters.channel = v('#fChannel'); filters.q = v('#fQ').trim();
        };
        const search = async () => { read(); offset = 0; await load(); };
        root.querySelector('#cSearch').addEventListener('click', search);
        root.querySelector('#cReset').addEventListener('click', async () => { for (const k of Object.keys(filters)) filters[k] = ''; offset = 0; await load(); });
        root.querySelector('#cToday').addEventListener('click', async () => {
          const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          filters.from = start.toISOString(); filters.to = now.toISOString(); offset = 0; await load();
        });
        root.querySelector('#c24').addEventListener('click', async () => {
          filters.from = new Date(Date.now() - 86400000).toISOString(); filters.to = new Date().toISOString(); offset = 0; await load();
        });
        root.querySelector('#fQ').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
        root.querySelector('#cPrev').addEventListener('click', async () => { offset = Math.max(0, offset - pageSize); await load(); });
        root.querySelector('#cNextPage').addEventListener('click', async () => { if (offset + pageSize < total) { offset += pageSize; await load(); } });
      }

      function stat(label, value, sub) {
        return `<article class="card stat-card"><div><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="card-sub" style="margin-top:4px">${sub}</div></div></article>`;
      }

      function row(r) {
        const okStatus = Number(r.status) >= 200 && Number(r.status) < 400;
        return `<tr>
          <td class="mono muted" style="white-space:nowrap" title="${RS.esc(r.id || '')}">${stamp(r.ts)}</td>
          <td style="max-width:190px">
            <div class="truncate text-sm">${RS.esc(r.user_id || '—')}</div>
            <div class="truncate mono text-xs muted" title="${RS.esc(r.key_name || '')}">${RS.esc(r.key_hint || '—')}${r.key_name ? ' · ' + RS.esc(r.key_name) : ''}</div>
          </td>
          <td class="truncate strong" style="max-width:150px" title="${RS.esc(r.model || '')}${r.upstream_model && r.upstream_model !== r.model ? ' → 上游 ' + RS.esc(r.upstream_model) : ''}">${RS.esc(r.model || '—')}${r.stream ? ' <span class="badge badge-blue" style="font-size:10px">stream</span>' : ''}${r.upstream_model && r.upstream_model !== r.model ? `<div class="text-xs muted mono truncate">→ ${RS.esc(r.upstream_model)}</div>` : ''}</td>
          <td style="max-width:150px"><div class="truncate">${RS.esc(r.channel_name || '—')}</div>${r.source_group ? `<div class="text-xs muted">${RS.esc(r.source_group)}</div>` : ''}</td>
          <td class="num tabular">${num(r.prompt_tokens)}</td>
          <td class="num tabular">${num(r.completion_tokens)}</td>
          <td class="num mono" title="原价 ${usd(r.list_cost)} × 倍率 ${Number(r.rate_multiplier || 1)}">${okStatus ? usd(r.cost) : '—'}${okStatus && Number(r.rate_multiplier || 1) !== 1 ? `<div class="text-xs muted">×${Number(r.rate_multiplier).toFixed(2)}</div>` : ''}</td>
          <td class="num mono">${r.latency_ms ? num(r.latency_ms) + ' ms' : '—'}</td>
          <td class="num">${RS.statusBadge(r.status)}</td>
          <td class="truncate" style="max-width:180px;color:${r.error ? '#e11d48' : 'inherit'}" title="${RS.esc((r.error_code ? r.error_code + ' · ' : '') + (r.error || ''))}">${RS.esc(r.error_code ? r.error_code + (r.error ? ' · ' + r.error : '') : '')}</td>
          <td style="max-width:150px"><div class="mono text-xs">${RS.esc(r.ip || '—')}</div><div class="truncate text-xs muted" title="${RS.esc(r.ua || '')}">${RS.esc(r.ua || '')}</div></td>
        </tr>`;
      }

      await load();
    }
  };
})();
