/* 仪表盘 */
(function () {
  'use strict';
  const V = window.RSViews;

  const RANGES = [{ id: '24h', label: '24 小时' }, { id: '7d', label: '7 天' }, { id: '30d', label: '30 天' }];

  V.dashboard = {
    title: '仪表盘',
    sub: '网关今天的运行情况',
    icon: 'dashboard',
    async mount(root, ctx) {
      const RS = window.RS;
      let range = ctx.state.range || '24h';
      let data = null;

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 正在汇总…</div></div>`;

      async function load() {
        try {
          const [snap, stateSnap, anns] = await Promise.all([
            RS.api('overview?range=' + range),
            RS.loadState(),
            RS.api('announcements').catch(() => [])
          ]);
          data = { snap, state: stateSnap, anns: (anns || []).filter(a => a.published !== false).slice(0, 2) };
          render();
        } catch (err) {
          if (err.code === 401) return RS.renderLogin ? RS.renderLogin() : location.reload();
          root.innerHTML = `<div class="empty">${RS.icon('alert')}<b>数据加载失败</b><span>${RS.esc(err.message)}</span></div>`;
        }
      }

      function render() {
        const { snap, state } = data;
        const t = snap.totals;
        const totals = snap.totals;
        const success = totals.requests ? 1 - totals.failures / totals.requests : 0;
        const models = (snap.models || []).slice(0, 60);
        const top = models.slice(0, 5);
        const rest = models.slice(5).reduce((a, m) => a + m.requests, 0);
        const donutItems = top.map((m, i) => ({ label: m.model, value: m.requests, color: [Ch().teal, Ch().blue, Ch().violet, Ch().amber, Ch().rose][i] }));
        if (rest > 0) donutItems.push({ label: '其他', value: rest, color: Ch().slate });

        const logs = (state.logs || []).slice(0, 8);
        const health = snap.health || [];

        root.innerHTML = `
        <div class="page-stack">
          ${(data.anns || []).map(a => `
            <div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:flex-start;border-color:${a.level === 'warning' ? 'rgba(245,158,11,.35)' : 'var(--border)'}">
              <span class="stat-icon ${a.level === 'warning' ? 'amber' : a.level === 'success' ? 'green' : 'blue'}" style="width:30px;height:30px">${RS.icon('sparkles')}</span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2"><b class="text-sm">${RS.esc(a.title)}</b><span class="muted-2 text-xs">${RS.when(a.created_at)}</span></div>
                <p class="text-xs muted mt-1" style="white-space:pre-wrap">${RS.esc(a.body || '')}</p>
              </div>
            </div>`).join('')}
          <!-- 指标卡 -->
          <div class="grid grid-cols-4 gap-4">
            ${statCard('blue', 'dashboard', '今日请求', RS.num(t.today_requests), `总请求 ${RS.num(t.all_requests)}`, '')}
            ${statCard('violet', 'layers', '今日 Token', RS.fmt(t.today_tokens), `输入 ${RS.fmt(t.today_input_tokens)} · 输出 ${RS.fmt(t.today_output_tokens)}`, '')}
            ${statCard('teal', 'wallet', '今日消费', '¥' + RS.fmtMoney(snap.today_cost), `区间合计 ¥${RS.fmtMoney(snap.cost)}`, '')}
            ${statCard('green', 'checkCircle', '成功率', (success * 100).toFixed(1) + '%', `失败 ${RS.num(totals.failures)} 次`, '')}
            ${statCard('amber', 'clock', '平均延迟', RS.ms(totals.avg_latency), `P95 ${RS.ms(totals.p95_latency)}`, '')}
            ${statCard('indigo', 'server', '渠道在线', `${(snap.counts.channels_enabled || 0)} / ${snap.counts.channels || 0}`, `密钥 ${snap.counts.keys_enabled || 0} / ${snap.counts.keys || 0} 可用`, '')}
            ${statCard('purple', 'activity', '区间请求', RS.num(totals.requests), `${RANGES.find(r => r.id === range).label}`, '')}
            ${statCard('rose', 'database', '累计 Token', RS.fmt(t.all_tokens), `全局 ${RS.num(t.all_requests)} 次请求`, '')}
          </div>

          <!-- 趋势 + 分布 -->
          <div class="grid grid-cols-4 gap-4">
            <section class="card col-span-3">
              <div class="card-header">
                <div>
                  <div class="card-title">用量趋势</div>
                  <div class="card-sub">请求量与 Token 消耗（${RANGES.find(r => r.id === range).label}）</div>
                </div>
                <div class="segmented" id="rangeTabs">
                  ${RANGES.map(r => `<button type="button" data-range="${r.id}" class="${r.id === range ? 'active' : ''}">${r.label}</button>`).join('')}
                </div>
              </div>
              <div class="card-body">
                <div class="chart-legend mb-3">
                  <span class="item"><i class="swatch" style="background:${Ch().teal}"></i>请求数</span>
                  <span class="item"><i class="swatch" style="background:${Ch().violet}"></i>Token</span>
                </div>
                <div class="chart-box" id="trendBox"><div class="chart-tip" id="trendTip"></div><canvas id="trendChart"></canvas></div>
              </div>
            </section>

            <section class="card col-span-1">
              <div class="card-header">
                <div><div class="card-title">模型分布</div><div class="card-sub">按请求数</div></div>
              </div>
              <div class="card-body">
                <div class="chart-box" style="height:172px"><canvas id="modelChart"></canvas></div>
                <div class="mt-3" id="modelLegend"></div>
              </div>
            </section>
          </div>

          <!-- 渠道健康 + 最近请求 -->
          <div class="grid grid-cols-4 gap-4">
            <section class="card col-span-2">
              <div class="card-header">
                <div><div class="card-title">渠道健康</div><div class="card-sub">上游线路的实时状态</div></div>
                <a class="btn btn-secondary btn-sm" href="#/channels">管理渠道</a>
              </div>
              <div class="card-body" id="healthList"></div>
            </section>

            <section class="card col-span-2">
              <div class="card-header">
                <div><div class="card-title">最近请求</div><div class="card-sub">最新的转发记录</div></div>
                <a class="btn btn-secondary btn-sm" href="#/logs">全部日志</a>
              </div>
              <div class="card-body flush">
                ${logs.length ? `<div class="table-wrap"><table class="table">
                  <thead><tr><th>时间</th><th>模型</th><th>渠道</th><th class="num">状态</th><th class="num">耗时</th></tr></thead>
                  <tbody>${logs.map(l => `<tr>
                    <td class="mono muted">${RS.when(l.ts)}</td>
                    <td class="truncate" style="max-width:150px">${RS.esc(l.model || '—')}</td>
                    <td class="truncate" style="max-width:110px">${RS.esc(l.channel_name || '—')}</td>
                    <td class="num">${RS.statusBadge(l.status)}</td>
                    <td class="num mono">${l.latency_ms ? RS.num(l.latency_ms) + ' ms' : '—'}</td>
                  </tr>`).join('')}</tbody></table></div>`
                  : `<div class="empty">${RS.icon('list')}<b>还没有请求</b><span>用控制台生成的密钥发起第一次调用，这里就会亮起来。</span></div>`}
              </div>
            </section>
          </div>

          <!-- 快捷操作 -->
          <section class="card">
            <div class="card-header"><div><div class="card-title">快捷操作</div><div class="card-sub">常用入口</div></div></div>
            <div class="card-body">
              <div class="grid grid-cols-4 gap-3">
                ${quick('server', 'blue', '新增上游渠道', '接入反代线路', 'channels')}
                ${quick('key', 'teal', '生成 API 密钥', '下游调用凭据', 'keys')}
                ${quick('layers', 'violet', '模型广场', '模型、单价与可用性', 'models')}
                ${quick('copy', 'amber', '复制接入命令', '一键拿到 curl 示例', 'copy')}
              </div>
            </div>
          </section>
        </div>`;

        // 趋势图
        const box = root.querySelector('#trendBox');
        const canvas = root.querySelector('#trendChart');
        const points = (snap.series || []).map(s => labelOf(s.t, range));
        const reqs = (snap.series || []).map(s => s.requests);
        const toks = (snap.series || []).map(s => s.input_tokens + s.output_tokens + s.cache_read_tokens);
        const move = window.RSCharts.line(canvas, {
          points, height: 232, tooltip: root.querySelector('#trendTip'),
          series: [
            { name: '请求数', values: reqs, color: Ch().teal, area: true },
            { name: 'Token', values: toks, color: Ch().violet, axis: 'right', area: false }
          ]
        });
        if (move) canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseleave', () => { root.querySelector('#trendTip').classList.remove('show'); window.RSCharts.line(canvas, { points, height: 232, series: [{ name: '请求数', values: reqs, color: Ch().teal, area: true }, { name: 'Token', values: toks, color: Ch().violet, axis: 'right', area: false }] }); });

        window.RSCharts.donut(root.querySelector('#modelChart'), donutItems, {
          height: 172, centerLabel: RS.fmt(totals.requests), centerSub: '总请求'
        });
        root.querySelector('#modelLegend').innerHTML = donutItems.length ? donutItems.map(m => `
          <div class="flex items-center justify-between" style="padding:5px 0;font-size:12px">
            <span class="flex items-center gap-2 min-w-0"><i class="swatch" style="width:7px;height:7px;border-radius:3px;background:${m.color};display:inline-block"></i>
            <span class="truncate" style="max-width:130px">${RS.esc(m.label)}</span></span>
            <span class="muted tabular">${totals.requests ? ((m.value / totals.requests) * 100).toFixed(1) : 0}%</span>
          </div>`).join('') : `<div class="muted text-xs text-center" style="padding:8px 0">暂无调用</div>`;

        // 渠道健康
        const hl = root.querySelector('#healthList');
        hl.innerHTML = health.length ? health.map(c => {
          const stat = (snap.channels || []).find(x => x.id === c.id) || {};
          const state2 = c.cooldown_ms > 0 ? { cls: 'badge-amber', text: '冷却中' } : (!c.enabled ? { cls: 'badge-gray', text: '已停用' } : { cls: 'badge-green', text: '健康' });
          return `<div class="row-item">
            <div class="lead">${RS.icon('server')}</div>
            <div class="grow">
              <div class="name">${RS.esc(c.name)}</div>
              <div class="meta">${RS.esc((c.models || []).join(' · ') || '全部模型')} · ${stat.requests || 0} 次 / ${RS.ms(stat.avg_latency)}</div>
            </div>
            <span class="spark-wrap" data-spark='${JSON.stringify(stat.spark || [])}'><canvas></canvas></span>
            <span class="badge ${state2.cls}"><i class="dot"></i>${state2.text}</span>
          </div>`;
        }).join('') : `<div class="empty">${RS.icon('server')}<b>还没有渠道</b><span>添加一条上游线路后，这里会显示它的健康度。</span></div>`;

        $$(hl, '.spark-wrap').forEach(el => {
          let vals = [];
          try { vals = JSON.parse(el.dataset.spark || '[]'); } catch (e) { vals = []; }
          if (!vals.length) vals = [0, 0];
          window.RSCharts.spark(el.querySelector('canvas'), vals, Ch().teal);
        });

        // 交互
        $$('[data-range]', root).forEach(b => b.addEventListener('click', () => {
          range = b.dataset.range; ctx.state.range = range; load();
        }));
        $$('[data-go]', root).forEach(b => b.addEventListener('click', () => {
          const target = b.dataset.go;
          if (target === 'copy') { RS.copy(accessCurl(), b); return; }
          RS.go(target);
        }));
      }

      function statCard(color, ic, label, value, hint) {
        return `<div class="card stat-card hover">
          <div class="stat-icon ${color}">${RS.icon(ic)}</div>
          <div class="min-w-0">
            <div class="stat-label">${label}</div>
            <div class="stat-value">${value}</div>
            <div class="stat-hint">${hint}</div>
          </div>
        </div>`;
      }

      function quick(ic, color, title, sub, target) {
        return `<button class="quick-tile" type="button" data-go="${target}">
          <span class="ico stat-icon ${color}">${RS.icon(ic)}</span>
          <span class="min-w-0"><b>${title}</b><span>${sub}</span></span>
          ${RS.icon('chevronRight')}
        </button>`;
      }

      function accessCurl() {
        const base = location.origin + (location.pathname.replace(/[^/]*$/, '')).replace(/\/$/, '') + '/v1';
        return `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer sk-relay-..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"你好"}]}'`;
      }

      function labelOf(iso, r) {
        const d = new Date(iso);
        if (isNaN(d)) return iso;
        const p = x => String(x).padStart(2, '0');
        return r === '24h' ? `${p(d.getHours())}:00` : `${p(d.getMonth() + 1)}/${p(d.getDate())}`;
      }

      await load();
      ctx.poll(() => load(), 20000);
    }
  };

  function Ch() { return window.RSCharts.colors; }
  function $$(a, b) {
    const root = typeof a === 'string' ? b : a;
    const sel = typeof a === 'string' ? a : b;
    return Array.from((root || document).querySelectorAll(sel));
  }
})();
