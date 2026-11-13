/* 操作日志：谁、什么时候、改了什么、改前改后、来自哪个 IP
 * 只记录写操作；密钥一律只显示掩码（服务端写入时已是 sk-…xxxx），页面不做任何解密。 */
(function () {
  'use strict';
  const V = window.RSViews;

  const LABELS = {
    'create source': '新增模型来源',
    'update source': '修改模型来源',
    'delete source': '删除模型来源',
    'update source config (json)': 'JSON 批量保存来源',
    'create source group': '新建来源分组',
    'update source group': '修改来源分组',
    'delete source group': '删除来源分组',
    'create key': '新增 API 密钥',
    'update key': '修改 API 密钥',
    'delete key': '删除 API 密钥',
    'create key group': '新建密钥分组',
    'update key group': '修改密钥分组',
    'credit key quota': '调整密钥额度',
    'update model pricing': '修改模型价格',
    'create redeem codes': '生成兑换码',
    'delete redeem code': '删除兑换码',
    'create announcement': '发布公告',
    'update announcement': '修改公告',
    'clear request logs': '清空请求日志',
    'rotate admin key': '轮换管理密钥'
  };

  const MASK_FIELDS = /(api_key|secret|password|authorization|adminKey)/i;
  const fmtValue = v => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (Array.isArray(v)) return v.length > 6 ? v.slice(0, 6).join(', ') + ` …(+${v.length - 6})` : v.join(', ');
    if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}=${fmtValue(x)}`).join(' · ');
    return String(v);
  };

  function changeText(item) {
    const { before, after } = item;
    // 调额度的记录用 before_usd / after_usd / amount_usd 三个平铺字段，单独排版。
    if (item.action === 'credit key quota') {
      const unit = item.currency === 'CNY' ? '元' : '$';
      return `额度 ${Number(item.before_usd ?? 0)} → ${Number(item.after_usd ?? 0)} ${unit}（+${Number(item.amount_usd ?? 0)}${item.note ? '；备注：' + item.note : ''}）`;
    }
    if (!before && !after) return item.note || '';
    if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => !MASK_FIELDS.test(k));
      // pricing 的 before/after 是「模型 → 价格」表，逐模型对比太吵，折叠成条数。
      const parts = keys.map(k => {
        const b = fmtValue(before[k]), a = fmtValue(after[k]);
        if (b === a) return null;
        if (before[k] && after[k] && typeof before[k] === 'object' && typeof after[k] === 'object') return `${k}：${Object.keys(before[k]).length} 项 → ${Object.keys(after[k]).length} 项`;
        return `${k}：${b} → ${a}`;
      }).filter(Boolean);
      return parts.length ? parts.slice(0, 4).join('；') + (parts.length > 4 ? `；…共 ${parts.length} 项变更` : '') : '无实质变化';
    }
    if (after && typeof after === 'object') return fmtValue(Object.fromEntries(Object.entries(after).filter(([k]) => !MASK_FIELDS.test(k))));
    if (before && typeof before === 'object') return fmtValue(Object.fromEntries(Object.entries(before).filter(([k]) => !MASK_FIELDS.test(k))));
    return String(before || after || '');
  }

  const actionText = a => LABELS[a] || String(a || '').replace(/^(GET|POST|PATCH|PUT|DELETE) /i, m => ({ GET: '读取 ', POST: '新增 ', PATCH: '修改 ', PUT: '保存 ', DELETE: '删除 ' }[m.trim().toUpperCase()] || m));
  const isRaw = a => !LABELS[a];

  V.audit = {
    title: '操作日志',
    sub: '谁在什么时候改了什么、改前改后、来自哪个 IP（密钥只显示掩码）',
    icon: 'list',
    async mount(root, ctx) {
      const RS = window.RS;
      let items = [];
      let q = '';
      let onlyWrite = true;

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取记录…</div></div>`;

      async function load() { items = (await RS.api('audit')) || []; render(); }

      function render() {
        const rows = items.filter(i => {
          if (onlyWrite && !(i.actor || i.target || i.before || i.after)) return false;
          if (!q) return true;
          const hay = `${i.action} ${actionText(i.action)} ${i.actor} ${i.target} ${i.ip} ${i.status}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        });
        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div><div class="card-title">管理动作</div><div class="card-sub">共 ${items.length} 条 · ${onlyWrite ? '只看后台写操作' : '显示全部记录'} · 保留最近 500 条</div></div>
              <div class="toolbar">
                <label class="flex items-center gap-2 text-sm" style="cursor:pointer">
                  <span class="switch"><input type="checkbox" id="aOnly" ${onlyWrite ? 'checked' : ''}><span></span></span>
                  只看写操作
                </label>
                <div style="position:relative">
                  <input class="input" id="aSearch" placeholder="搜索动作 / 对象 / IP" value="${RS.esc(q)}" style="padding-left:34px;min-width:240px">
                  <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted-2);width:15px;height:15px">${RS.icon('search')}</span>
                </div>
              </div>
            </div>
            <div class="card-body flush">
              ${rows.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>变更（改前 → 改后）</th><th>来源 IP</th><th class="num">结果</th></tr></thead>
                <tbody>${rows.map(i => `<tr>
                  <td class="mono muted" style="white-space:nowrap">${RS.when(i.ts)}</td>
                  <td>${i.actor ? `<span class="badge badge-gray">${RS.esc(i.actor)}</span>` : '<span class="muted-2">—</span>'}</td>
                  <td class="${isRaw(i.action) ? 'mono muted' : 'strong'}">${RS.esc(actionText(i.action))}</td>
                  <td class="truncate" style="max-width:220px" title="${RS.esc(i.target || '')}">${RS.esc(i.target || '—')}${i.key_hint ? ` <span class="mono muted-2">${RS.esc(i.key_hint)}</span>` : ''}</td>
                  <td class="muted truncate" style="max-width:420px" title="${RS.esc(changeText(i))}">${RS.esc(changeText(i) || '—')}</td>
                  <td class="mono muted-2">${RS.esc(i.ip || '—')}</td>
                  <td class="num">${!Number.isFinite(Number(i.status)) ? '<span class="badge badge-green">成功</span>' : Number(i.status) < 300 ? `<span class="badge badge-green">${i.status}</span>` : `<span class="badge badge-red">${i.status}</span>`}</td>
                </tr>`).join('')}</tbody></table></div>`
                : `<div class="empty">${RS.icon('list')}<b>暂无记录</b><span>新增来源、调额度、改价格、发兑换码等写操作都会落在这里；每一条都带操作者、改前改后与来源 IP。</span></div>`}
            </div>
          </section>
        </div>`;
        const search = root.querySelector('#aSearch');
        search.addEventListener('input', () => { q = search.value; const pos = search.selectionStart; render(); const el = root.querySelector('#aSearch'); el.focus(); el.setSelectionRange(pos, pos); });
        root.querySelector('#aOnly').addEventListener('change', ev => { onlyWrite = ev.target.checked; render(); });
      }

      await load();
      ctx.poll(load, 20000);
    }
  };
})();
