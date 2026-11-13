/* 用户分组：可用模型范围 + 计费倍率 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.usergroups = {
    title: '用户分组',
    sub: 'default / vip / test 等账户分组：限定可用模型、按倍率计费',
    icon: 'layers',
    async mount(root, ctx) {
      const RS = window.RS;
      let groups = [], models = [], currency = 'USD', basis = '';

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取分组…</div></div>`;

      async function load() {
        const [res, m] = await Promise.all([RS.api('user-groups'), RS.api('models').catch(() => ({ items: [] }))]);
        groups = Array.isArray(res) ? res : (res.items || []);
        currency = (res && res.currency) || 'USD';
        basis = (res && res.multiplier_basis) || '';
        models = (m.items || []).map(x => x.model);
        render();
      }

      function chipList(list) {
        const arr = list && list.length ? list : ['*'];
        if (arr.includes('*')) return '<span class="badge badge-green">全部模型</span>';
        return arr.slice(0, 4).map(x => `<span class="chip">${RS.esc(x)}</span>`).join(' ') + (arr.length > 4 ? ` <span class="chip">+${arr.length - 4}</span>` : '');
      }

      function render() {
        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div><div class="card-title">账户分组</div><div class="card-sub">共 ${groups.length} 个 · 倍率 1 = 原价，0.8 = 八折计费，1.5 = 加价 50%</div></div>
              <div class="toolbar"><button class="btn btn-primary btn-sm" id="ugNew">${RS.icon('plus')} 新建分组</button></div>
            </div>
            <div class="card-body flush">
              ${groups.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>名称</th><th>可用模型</th><th class="num">计费倍率</th><th class="num">成员</th><th>备注</th><th>状态</th><th class="num">操作</th></tr></thead>
                <tbody>${groups.map(g => `<tr data-id="${RS.esc(g.id)}">
                  <td class="strong">${RS.esc(g.name)}</td>
                  <td>${chipList(g.models)}</td>
                  <td class="num mono">×${Number(g.rate_multiplier || 1)}</td>
                  <td class="num tabular" title="${RS.esc((g.members || []).join(', '))}">${g.member_count || 0}</td>
                  <td class="muted truncate" style="max-width:200px">${RS.esc(g.note || '—')}</td>
                  <td>${g.enabled === false ? '<span class="badge badge-gray">已停用</span>' : '<span class="badge badge-green">启用</span>'}</td>
                  <td class="num"><div class="inline-flex gap-1" style="justify-content:flex-end">
                    <button class="btn btn-secondary btn-sm" data-act="edit">${RS.icon('edit')}</button>
                    <button class="btn btn-danger btn-sm" data-act="del">${RS.icon('trash')}</button>
                  </div></td>
                </tr>`).join('')}</tbody></table></div>`
                : `<div class="empty">${RS.icon('layers')}<b>还没有用户分组</b><span>建一个「test」分组只放开部分模型，用来验证拦截效果。</span></div>`}
            </div>
          </section>
          <section class="card">
            <div class="card-header"><div><div class="card-title">怎么用</div><div class="card-sub">原生逻辑，无需额外插件</div></div></div>
            <div class="card-body">
              <p class="text-sm muted">分组在「用户信息 → 详情」里分配给账户。分配后：① 该账户所有密钥只能调用组内模型，越界返回 403 <code>model_not_allowed</code>；② 计费按「模型单价 × 倍率」扣余额，倍率同时写入调用记录与账单。计费单位 ${RS.esc(currency)}，${RS.esc(basis || '1 USD = 1,000,000 micro-credits')}。</p>
              <div class="toolbar mt-4"><a class="btn btn-secondary btn-sm" href="#/users">去分配分组</a><a class="btn btn-secondary btn-sm" href="#/calls">查看调用记录</a></div>
            </div>
          </section>
        </div>`;

        root.querySelector('#ugNew').addEventListener('click', () => openForm(null));
        root.querySelectorAll('tr[data-id]').forEach(tr => {
          const g = groups.find(x => x.id === tr.dataset.id);
          tr.querySelector('[data-act="edit"]').addEventListener('click', () => openForm(g));
          tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
            const ok = await RS.confirmDialog({ title: '删除分组', message: `删除「${g.name}」后，组内 ${g.member_count || 0} 个账户会变成「未分组」（不限模型、倍率 1）。`, danger: true, confirmText: '删除' });
            if (!ok) return;
            try { await RS.api('user-groups/' + encodeURIComponent(g.id), { method: 'DELETE' }); RS.toast('分组已删除'); await load(); } catch (err) { RS.toast(err.message, 'error'); }
          });
        });
      }

      function openForm(g) {
        const editing = Boolean(g);
        const selected = (g && g.models && g.models.length ? g.models : ['*']);
        const m = RS.modal({
          title: editing ? '编辑用户分组' : '新建用户分组',
          sub: editing ? g.name : '例如 default / vip / test',
          body: `
            <form id="ugForm">
              <div class="grid grid-cols-2 gap-3">
                <div class="field"><label class="input-label" for="ugName">名称</label><input class="input" id="ugName" name="name" maxlength="60" required value="${RS.esc(editing ? g.name : '')}" placeholder="test"></div>
                <div class="field"><label class="input-label" for="ugRate">计费倍率（0.1 – 100）</label><input class="input" id="ugRate" name="rate" type="number" min="0.1" max="100" step="0.01" value="${Number(editing ? g.rate_multiplier : 1)}"></div>
              </div>
              <div class="field"><label class="input-label">可用模型（不选 = 全部模型）</label>
                <div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px;border:1px solid var(--border);border-radius:10px;max-height:160px;overflow:auto">
                  ${(models.length ? models : ['glm-5.3', 'glm-5.3-flash']).map(name => `<label class="flex items-center gap-2 text-sm" style="cursor:pointer">
                    <input type="checkbox" class="ugModel" value="${RS.esc(name)}" ${selected.includes(name) ? 'checked' : ''}> ${RS.esc(name)}
                  </label>`).join('')}
                </div>
                <p class="input-hint">一个都不勾选表示不限模型（等价 *）。</p>
              </div>
              <div class="field"><label class="input-label" for="ugNote">备注</label><input class="input" id="ugNote" name="note" maxlength="200" value="${RS.esc(editing ? (g.note || '') : '')}"></div>
              <div class="field"><label class="flex items-center gap-2 text-sm"><span class="switch"><input type="checkbox" id="ugEnabled" ${!editing || g.enabled !== false ? 'checked' : ''}><span></span></span> 启用该分组</label></div>
              <p class="field-error" id="ugErr"></p>
            </form>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" type="submit" form="ugForm">${editing ? '保存' : '创建'}</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('form').addEventListener('submit', async ev => {
          ev.preventDefault();
          const f = new FormData(ev.target);
          const picked = [...m.querySelectorAll('.ugModel:checked')].map(x => x.value);
          const payload = { name: String(f.get('name')).trim(), rate_multiplier: Number(f.get('rate')), models: picked.length ? picked : ['*'], note: String(f.get('note') || ''), enabled: m.querySelector('#ugEnabled').checked };
          const btn = m.querySelector('[type=submit]'); btn.disabled = true;
          try {
            if (editing) await RS.api('user-groups/' + encodeURIComponent(g.id), { method: 'PATCH', body: payload });
            else await RS.api('user-groups', { method: 'POST', body: payload });
            RS.closeModal(); RS.toast(editing ? '分组已保存' : '分组已创建'); await load();
          } catch (err) { m.querySelector('#ugErr').textContent = err.message; btn.disabled = false; }
        });
      }

      await load();
    }
  };
})();
