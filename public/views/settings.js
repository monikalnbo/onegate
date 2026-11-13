/* 设置 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.settings = {
    title: '设置',
    sub: '接入地址、模型单价与管理密钥',
    icon: 'settings',
    async mount(root, ctx) {
      const RS = window.RS;
      let pricing = {};
      let system = null;
      let rows = [];

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取配置…</div></div>`;

      async function load() {
        const [p, s] = await Promise.all([RS.api('pricing'), RS.api('system').catch(() => null)]);
        pricing = p || {};
        system = s;
        rows = Object.entries(pricing).map(([model, r]) => ({ model, in: r.in, out: r.out, cache: r.cache ?? 0 }));
        if (!rows.length) rows = [{ model: '', in: 0, out: 0, cache: 0 }];
        render();
      }

      function render() {
        root.innerHTML = `
        <div class="page-stack">
          <div class="grid grid-cols-4 gap-4">
            <section class="card col-span-2">
              <div class="card-header"><div><div class="card-title">接入信息</div><div class="card-sub">下游客户端使用这个地址</div></div></div>
              <div class="card-body">
                <div class="field"><label class="input-label">Base URL</label>
                  <div class="flex gap-2">
                    <input class="input mono" id="baseUrl" readonly value="${RS.esc(apiBase())}">
                    <button class="btn btn-secondary" id="copyBase">${RS.icon('copy')}</button>
                  </div>
                  <p class="input-hint">OpenAI SDK 填 <code class="inline">base_url</code> 时需带 <code class="inline">/v1</code>；Claude Code 用 <code class="inline">ANTHROPIC_BASE_URL</code> 指向同一地址。</p>
                </div>
                <div class="field"><label class="input-label">调用示例</label>
                  <div class="code-block"><button class="btn btn-secondary btn-sm copy-btn" id="copyCurl">${RS.icon('copy')}</button>${RS.esc(curl())}</div>
                </div>
                <div class="field">
                  <label class="input-label">支持的接口</label>
                  <div class="flex flex-wrap gap-2">
                    ${['/v1/chat/completions', '/v1/embeddings', '/v1/responses', '/v1/models'].map(x => `<span class="chip">${x}</span>`).join('')}
                  </div>
                </div>
              </div>
            </section>

            <section class="card col-span-2">
              <div class="card-header"><div><div class="card-title">系统信息</div><div class="card-sub">运行状态</div></div></div>
              <div class="card-body">
                <div class="grid grid-cols-2 gap-3">
                  ${info('版本', 'v' + RS.esc((system && system.version) || RS.state.version))}
                  ${info('Node', RS.esc((system && system.node) || '—'))}
                  ${info('运行时长', system ? uptime(system.uptime_s) : '—')}
                  ${info('内存占用', system ? system.rss_mb + ' MB' : '—')}
                  ${info('渠道 / 密钥', system ? `${system.channels} / ${system.keys}` : '—')}
                  ${info('日志条数', system ? RS.num(system.logs) : '—')}
                </div>
                <div class="divider"></div>
                <div class="flex items-center justify-between">
                  <span class="text-xs muted">Docker · onegate</span>
                  <span class="badge badge-green"><i class="dot"></i>运行中</span>
                </div>
              </div>
            </section>
          </div>

          <section class="card">
            <div class="card-header">
              <div><div class="card-title">模型单价</div><div class="card-sub">每 100 万 Token 的价格，用于消费统计</div></div>
              <div class="toolbar">
                <button class="btn btn-secondary btn-sm" id="addRow">${RS.icon('plus')} 添加模型</button>
                <button class="btn btn-primary btn-sm" id="savePricing">${RS.icon('check')} 保存单价</button>
              </div>
            </div>
            <div class="card-body flush">
              <div class="table-wrap"><table class="table">
                <thead><tr><th style="width:38%">模型</th><th class="num">输入 / 1M</th><th class="num">输出 / 1M</th><th class="num">缓存读 / 1M</th><th class="num" style="width:60px"></th></tr></thead>
                <tbody>
                  ${rows.map((r, i) => `<tr data-row="${i}">
                    <td><input class="input mono" data-f="model" value="${RS.esc(r.model)}" placeholder="gpt-4o"></td>
                    <td class="num"><input class="input mono text-right" data-f="in" type="number" step="0.0001" min="0" value="${r.in}"></td>
                    <td class="num"><input class="input mono text-right" data-f="out" type="number" step="0.0001" min="0" value="${r.out}"></td>
                    <td class="num"><input class="input mono text-right" data-f="cache" type="number" step="0.0001" min="0" value="${r.cache}"></td>
                    <td class="num"><button class="btn btn-ghost btn-icon btn-sm" data-del="${i}" title="删除">${RS.icon('trash')}</button></td>
                  </tr>`).join('')}
                </tbody>
              </table></div>
            </div>
            <div class="card-footer"><p class="input-hint" style="margin:0">单价用于用户额度扣减，按每百万 Token 计。客户账户调用未定价模型会被暂停，需先确认并保存价格。</p></div>
          </section>

          <div class="grid grid-cols-2 gap-4">
            <section class="card">
              <div class="card-header"><div><div class="card-title">管理密钥</div><div class="card-sub">修改后需重新登录</div></div></div>
              <div class="card-body">
                <div class="field"><label class="input-label">新管理密钥</label>
                  <input class="input" id="newAdminKey" type="password" placeholder="至少 12 个字符" autocomplete="new-password"></div>
                <div class="field"><label class="input-label">确认</label>
                  <input class="input" id="newAdminKey2" type="password" placeholder="再输一次" autocomplete="new-password"></div>
                <p class="field-error" id="akErr"></p>
                <button class="btn btn-primary" id="saveAdminKey">${RS.icon('key')} 更新管理密钥</button>
                <p class="input-hint">明文不入库，只保存在服务器 <code class="inline">data/admin.key</code> 与进程内存。</p>
              </div>
            </section>

            <section class="card">
              <div class="card-header"><div><div class="card-title">外观与维护</div><div class="card-sub">主题、日志与数据</div></div></div>
              <div class="card-body">
                <div class="flex items-center justify-between" style="padding:8px 0">
                  <div><div class="text-sm font-medium">深色模式</div><div class="text-xs muted">跟随系统，可手动切换</div></div>
                  <label class="switch"><input type="checkbox" id="themeSwitch" ${RS.theme() === 'dark' ? 'checked' : ''}><span></span></label>
                </div>
                <div class="divider"></div>
                <div class="flex items-center justify-between" style="padding:8px 0">
                  <div><div class="text-sm font-medium">清空请求日志</div><div class="text-xs muted">保留用量统计与渠道数据</div></div>
                  <button class="btn btn-danger btn-sm" id="clearLogs">清空</button>
                </div>
                <div class="divider"></div>
                <div class="flex items-center justify-between" style="padding:8px 0">
                  <div><div class="text-sm font-medium">数据文件</div><div class="text-xs muted mono">data/relay.json · metrics.json · pricing.json</div></div>
                  <span class="badge badge-gray">JSON</span>
                </div>
                <p class="input-hint" style="margin-top:10px">备份：<code class="inline">tar czf onegate-data-$(date +%F).tgz -C /path/to/onegate data/</code></p>
              </div>
            </section>
          </div>
        </div>`;

        root.querySelector('#copyBase').addEventListener('click', ev => RS.copy(apiBase(), ev.currentTarget));
        root.querySelector('#copyCurl').addEventListener('click', ev => RS.copy(curl(), ev.currentTarget));

        root.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
          const i = Number(inp.closest('tr').dataset.row);
          rows[i][inp.dataset.f] = inp.dataset.f === 'model' ? inp.value.trim() : Math.max(0, Number(inp.value) || 0);
        }));
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
          rows.splice(Number(b.dataset.del), 1);
          if (!rows.length) rows.push({ model: '', in: 0, out: 0, cache: 0 });
          render();
        }));
        root.querySelector('#addRow').addEventListener('click', () => { rows.push({ model: '', in: 0, out: 0, cache: 0 }); render(); });

        root.querySelector('#savePricing').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          const table = {};
          for (const r of rows) {
            if (!r.model) continue;
            table[r.model] = { in: Number(r.in) || 0, out: Number(r.out) || 0, cache: Number(r.cache) || 0 };
          }
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
          try {
            pricing = await RS.api('pricing', { method: 'PUT', body: table });
            RS.toast('单价已保存');
            await load();
          } catch (err) { RS.toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = RS.icon('check') + ' 保存单价'; }
        });

        root.querySelector('#themeSwitch').addEventListener('change', ev => RS.applyTheme(ev.target.checked ? 'dark' : 'light'));
        root.querySelector('#clearLogs').addEventListener('click', async () => {
          const ok = await RS.confirmDialog({ title: '清空日志', message: '清空后日志不可恢复，用量统计保留。', danger: true, confirmText: '清空' });
          if (!ok) return;
          await RS.api('logs', { method: 'DELETE' }); RS.toast('日志已清空');
        });

        root.querySelector('#saveAdminKey').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          const a = root.querySelector('#newAdminKey').value;
          const b = root.querySelector('#newAdminKey2').value;
          const err = root.querySelector('#akErr');
          if (a.length < 12) { err.textContent = '至少 12 个字符'; return; }
          if (a !== b) { err.textContent = '两次输入不一致'; return; }
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 更新中…';
          try {
            await RS.api('admin-key', { method: 'PUT', body: { adminKey: a } });
            err.textContent = '';
            RS.toast('管理密钥已更新，下次登录生效');
            root.querySelector('#newAdminKey').value = ''; root.querySelector('#newAdminKey2').value = '';
          } catch (e) { err.textContent = e.message; }
          finally { btn.disabled = false; btn.innerHTML = RS.icon('key') + ' 更新管理密钥'; }
        });
      }

      function info(label, value) {
        return `<div style="padding:9px 12px;background:var(--surface-2);border-radius:10px">
          <div class="text-xs muted">${label}</div>
          <div class="text-sm font-medium mono truncate" style="margin-top:2px">${value}</div>
        </div>`;
      }
      function uptime(s) {
        s = Number(s) || 0;
        const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
        return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分钟`;
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

      await load();
    }
  };
})();
