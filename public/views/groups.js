/* 分组管理 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.groups = {
    title: '分组管理',
    sub: '把密钥绑定到模型集合，按客户分层',
    icon: 'globe',
    async mount(root, ctx) {
      const RS = window.RS;
      let groups = [];
      let models = [];
      let keys = [];

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取分组…</div></div>`;

      async function load() {
        const [g, m, s] = await Promise.all([RS.api('groups'), RS.api('models').catch(() => ({ items: [] })), RS.loadState()]);
        groups = g || [];
        models = (m.items || []).map(x => x.model);
        keys = s.keys || [];
        render();
      }

      function render() {
        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div><div class="card-title">分组</div><div class="card-sub">共 ${groups.length} 个 · 密钥绑定分组后只能调用组内模型</div></div>
              <button class="btn btn-primary btn-sm" id="newGroup">${RS.icon('plus')} 新建分组</button>
            </div>
            <div class="card-body flush">
              ${groups.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>名称</th><th>可用模型</th><th>备注</th><th class="num">密钥数</th><th>状态</th><th class="num">操作</th></tr></thead>
                <tbody>${groups.map(g => `<tr data-id="${RS.esc(g.id)}">
                  <td class="strong">${RS.esc(g.name)}</td>
                  <td>${(g.models || ['*']).slice(0, 4).map(m => `<span class="chip">${RS.esc(m)}</span>`).join(' ')}${(g.models || []).length > 4 ? ` <span class="chip">+${g.models.length - 4}</span>` : ''}</td>
                  <td class="muted truncate" style="max-width:180px">${RS.esc(g.note || '—')}</td>
                  <td class="num tabular">${keys.filter(k => k.group_id === g.id).length}</td>
                  <td>${g.enabled === false ? '<span class="badge badge-gray">已停用</span>' : '<span class="badge badge-green"><i class="dot"></i>启用</span>'}</td>
                  <td class="num"><div class="inline-flex gap-1" style="justify-content:flex-end">
                    <button class="btn btn-secondary btn-sm" data-act="edit">${RS.icon('edit')}</button>
                    <button class="btn btn-danger btn-sm" data-act="del">${RS.icon('trash')}</button>
                  </div></td>
                </tr>`).join('')}</tbody></table></div>`
                : `<div class="empty">${RS.icon('globe')}<b>还没有分组</b><span>分组用来给不同客户不同的模型范围，比如「基础版」只开 3 个便宜模型。</span></div>`}
            </div>
          </section>
          <section class="card">
            <div class="card-header"><div><div class="card-title">怎么用</div><div class="card-sub">三步</div></div></div>
            <div class="card-body">
              <div class="grid grid-cols-3 gap-3">
                ${step('1', '建分组', '选好这个分组允许的模型，留空或 * 表示不限')}
                ${step('2', '绑密钥', '在「API 密钥」里新建或编辑，选择所属分组')}
                ${step('3', '发额度', '给密钥设额度上限，用完后自动返回 402')}
              </div>
            </div>
          </section>
        </div>`;

        root.querySelector('#newGroup').addEventListener('click', () => openForm(null));
        root.querySelectorAll('tr[data-id]').forEach(tr => {
          const g = groups.find(x => x.id === tr.dataset.id);
          tr.querySelector('[data-act="edit"]').addEventListener('click', () => openForm(g));
          tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
            const ok = await RS.confirmDialog({ title: '删除分组', message: `删除「${g.name}」后，绑定它的密钥会变成不限模型。`, danger: true, confirmText: '删除' });
            if (!ok) return;
            await RS.api('groups/' + encodeURIComponent(g.id), { method: 'DELETE' });
            RS.toast('分组已删除'); await load();
          });
        });
      }

      function step(n, t, d) {
        return `<div style="padding:14px;background:var(--surface-2);border-radius:12px">
          <div class="badge badge-teal" style="margin-bottom:6px">第 ${n} 步</div>
          <div class="text-sm font-semibold">${t}</div>
          <div class="text-xs muted mt-1">${d}</div>
        </div>`;
      }

      function openForm(g) {
        const editing = !!g;
        const cur = g || { name: '', models: ['*'], note: '', enabled: true };
        const m = RS.modal({
          title: editing ? '编辑分组' : '新建分组',
          sub: '选择该分组允许调用的模型',
          wide: true,
          body: `
            <div class="grid grid-cols-2 gap-4">
              <div class="field"><label class="input-label">分组名称</label>
                <input class="input" id="gName" value="${RS.esc(cur.name)}" placeholder="基础版 / VIP"></div>
              <div class="field"><label class="input-label">备注</label>
                <input class="input" id="gNote" value="${RS.esc(cur.note || '')}" placeholder="给谁用、什么价"></div>
            </div>
            <div class="field">
              <label class="input-label">允许的模型</label>
              <div class="flex items-center gap-2 mb-2">
                <label class="flex items-center gap-2 text-sm" style="cursor:pointer">
                  <span class="switch"><input type="checkbox" id="gAll" ${(cur.models || []).includes('*') ? 'checked' : ''}><span></span></span> 不限模型
                </label>
              </div>
              <div id="gModels" class="grid grid-cols-3 gap-2" style="max-height:260px;overflow:auto;padding:2px">
                ${models.length ? models.map(name => `<label class="flex items-center gap-2 text-xs" style="cursor:pointer;padding:6px 8px;background:var(--surface-2);border-radius:8px">
                  <input type="checkbox" value="${RS.esc(name)}" ${(cur.models || []).includes(name) ? 'checked' : ''}>
                  <span class="truncate">${RS.esc(name)}</span></label>`).join('') : '<div class="muted text-xs">暂无可选模型（先在渠道里填模型）</div>'}
              </div>
            </div>
            <label class="flex items-center gap-2" style="cursor:pointer">
              <span class="switch"><input type="checkbox" id="gEnabled" ${cur.enabled !== false ? 'checked' : ''}><span></span></span>
              <span class="text-sm">启用该分组</span>
            </label>
            <p class="field-error" id="gErr"></p>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button>
                   <button class="btn btn-primary" id="gSave">${editing ? '保存' : '创建'}</button>`
        });
        const all = m.querySelector('#gAll');
        const boxes = () => Array.from(m.querySelectorAll('#gModels input[type=checkbox]'));
        all.addEventListener('change', () => boxes().forEach(b => { b.checked = false; b.disabled = all.checked; }));
        boxes().forEach(b => { b.disabled = all.checked; });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#gSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          const selected = all.checked ? ['*'] : boxes().filter(b => b.checked).map(b => b.value);
          const payload = { name: m.querySelector('#gName').value.trim() || '分组', note: m.querySelector('#gNote').value.trim(), models: selected.length ? selected : ['*'], enabled: m.querySelector('#gEnabled').checked };
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
          try {
            if (editing) await RS.api('groups/' + encodeURIComponent(g.id), { method: 'PATCH', body: payload });
            else await RS.api('groups', { method: 'POST', body: payload });
            RS.closeModal(); RS.toast(editing ? '分组已更新' : '分组已创建'); await load();
          } catch (err) { m.querySelector('#gErr').textContent = err.message; btn.disabled = false; btn.textContent = editing ? '保存' : '创建'; }
        });
      }

      await load();
      ctx.poll(async () => { await load(); }, 30000);
    }
  };
})();
