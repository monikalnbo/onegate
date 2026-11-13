/* 请求日志 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.logs = {
    title: '请求日志',
    sub: '最近的转发流水（最多 500 条）',
    icon: 'terminal',
    async mount(root, ctx) {
      const RS = window.RS;
      let paused = false;
      let onlyError = false;
      let q = '';
      let pulse = [];
      let logs = [];

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取日志…</div></div>`;

      async function load() {
        const [snap, p] = await Promise.all([RS.loadState(), RS.api('pulse').catch(() => [])]);
        logs = snap.logs || [];
        pulse = p || [];
        if (!paused) render();
      }

      function render() {
        const rows = logs.filter(l => {
          if (onlyError && Number(l.status) < 400) return false;
          if (q && !(l.model + ' ' + l.channel_name + ' ' + l.key_name + ' ' + (l.error || '')).toLowerCase().includes(q.toLowerCase())) return false;
          return true;
        });

        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div>
                <div class="card-title">实时流水</div>
                <div class="card-sub">${logs.length} 条 · ${paused ? '已暂停刷新' : '每 5 秒自动刷新'}</div>
              </div>
              <div class="toolbar">
                <div style="position:relative">
                  <input class="input" id="lSearch" placeholder="搜索模型 / 渠道 / 错误" value="${RS.esc(q)}" style="padding-left:34px;min-width:210px">
                  <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted-2);width:15px;height:15px">${RS.icon('search')}</span>
                </div>
                <label class="flex items-center gap-2 text-sm" style="cursor:pointer">
                  <span class="switch"><input type="checkbox" id="lErr" ${onlyError ? 'checked' : ''}><span></span></span> 只看失败
                </label>
                <button class="btn btn-secondary btn-sm" id="lPause">${RS.icon(paused ? 'play' : 'pause')} ${paused ? '继续' : '暂停'}</button>
                <button class="btn btn-danger btn-sm" id="lClear">${RS.icon('trash')} 清空</button>
              </div>
            </div>
            <div class="card-body" style="padding:14px 22px">
              <div class="flex items-center gap-2 flex-wrap" title="最近 30 次转发">
                <span class="muted-2 text-xs">最近转发</span>
                ${pulse.length ? pulse.slice(-30).map(p => {
                  const ok = Number(p.status) < 400;
                  return `<span title="${RS.esc((p.channel || '未路由') + ' · ' + (p.status || '') + ' · ' + (p.model || ''))}"
                    style="width:9px;height:9px;border-radius:3px;background:${ok ? '#10b981' : '#f43f5e'};opacity:${ok ? .85 : 1}"></span>`;
                }).join('') : `<span class="muted-2 text-xs">暂无</span>`}
              </div>
            </div>
            <div class="card-body flush">
              ${rows.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>时间</th><th>密钥</th><th>模型</th><th>渠道</th><th class="num">状态</th><th class="num">耗时</th><th class="num">输入</th><th class="num">输出</th><th>错误</th></tr></thead>
                <tbody>${rows.map(row).join('')}</tbody>
              </table></div>`
              : `<div class="empty">${RS.icon('terminal')}<b>暂无日志</b><span>发起一次调用，这里会实时滚动。</span></div>`}
            </div>
          </section>
        </div>`;

        const search = root.querySelector('#lSearch');
        search.addEventListener('input', () => { q = search.value; render(); const el = root.querySelector('#lSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
        root.querySelector('#lErr').addEventListener('change', ev => { onlyError = ev.target.checked; render(); });
        root.querySelector('#lPause').addEventListener('click', () => { paused = !paused; render(); });
        root.querySelector('#lClear').addEventListener('click', async () => {
          const ok = await RS.confirmDialog({ title: '清空日志', message: '清空后历史请求记录不可恢复（用量统计不受影响）。', danger: true, confirmText: '清空' });
          if (!ok) return;
          await RS.api('logs', { method: 'DELETE' });
          RS.toast('日志已清空');
          await load();
        });
      }

      function row(l) {
        return `<tr>
          <td class="mono muted" style="white-space:nowrap">${RS.when(l.ts)}</td>
          <td class="truncate" style="max-width:110px">${RS.esc(l.key_name || '—')}</td>
          <td class="truncate strong" style="max-width:170px">${RS.esc(l.model || '—')}${l.stream ? ' <span class="badge badge-blue" style="font-size:10px">stream</span>' : ''}</td>
          <td class="truncate" style="max-width:110px">${RS.esc(l.channel_name || '—')}</td>
          <td class="num">${RS.statusBadge(l.status)}</td>
          <td class="num mono">${l.latency_ms ? RS.num(l.latency_ms) + ' ms' : '—'}</td>
          <td class="num tabular">${RS.num(l.prompt_tokens)}</td>
          <td class="num tabular">${RS.num(l.completion_tokens)}</td>
          <td class="truncate" style="max-width:220px;color:${l.error ? '#e11d48' : 'inherit'}" title="${RS.esc(l.error || '')}">${RS.esc(l.error || '')}</td>
        </tr>`;
      }

      await load();
      ctx.poll(async () => { if (!paused) { const snap = await RS.loadState(); logs = snap.logs || []; const p = await RS.api('pulse').catch(() => pulse); pulse = p; render(); } }, 5000);
    }
  };
})();
