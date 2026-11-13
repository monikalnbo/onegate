/* 公告 */
(function () {
  'use strict';
  const V = window.RSViews;

  V.announcements = {
    title: '公告',
    sub: '控制台首页对内部的提示',
    icon: 'sparkles',
    async mount(root, ctx) {
      const RS = window.RS;
      let items = [];

      root.innerHTML = `<div class="page-stack"><div class="loading-block"><span class="spinner"></span> 读取公告…</div></div>`;

      async function load() { items = (await RS.api('announcements')) || []; render(); }

      function render() {
        root.innerHTML = `
        <div class="page-stack">
          <section class="card">
            <div class="card-header">
              <div><div class="card-title">公告列表</div><div class="card-sub">共 ${items.length} 条 · 已发布 ${items.filter(a => a.published !== false).length} 条</div></div>
              <button class="btn btn-primary btn-sm" id="newAnn">${RS.icon('plus')} 新建公告</button>
            </div>
            <div class="card-body">
              ${items.length ? `<div class="page-stack" style="gap:10px">${items.map(card).join('')}</div>`
                : `<div class="empty">${RS.icon('sparkles')}<b>还没有公告</b><span>公告会显示在仪表盘顶部，适合发布维护通知、价格调整。</span></div>`}
            </div>
          </section>
        </div>`;

        root.querySelector('#newAnn').addEventListener('click', () => openForm(null));
        root.querySelectorAll('[data-id]').forEach(el => {
          const a = items.find(x => x.id === el.dataset.id);
          el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
            if (btn.dataset.act === 'edit') return openForm(a);
            if (btn.dataset.act === 'del') {
              const ok = await RS.confirmDialog({ title: '删除公告', message: '删除后不可恢复。', danger: true, confirmText: '删除' });
              if (!ok) return;
              await RS.api('announcements/' + encodeURIComponent(a.id), { method: 'DELETE' });
              RS.toast('公告已删除'); await load(); return;
            }
            if (btn.dataset.act === 'toggle') {
              await RS.api('announcements/' + encodeURIComponent(a.id), { method: 'PATCH', body: { published: a.published === false } });
              await load();
            }
          }));
        });
      }

      function card(a) {
        const color = a.level === 'warning' ? 'amber' : a.level === 'success' ? 'green' : 'blue';
        return `<div class="card" data-id="${RS.esc(a.id)}" style="padding:14px 16px;box-shadow:none;background:var(--surface-2);border-color:transparent">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="badge badge-${color}"><i class="dot"></i>${a.level === 'warning' ? '提醒' : a.level === 'success' ? '好消息' : '通知'}</span>
                ${a.pinned ? '<span class="badge badge-purple">置顶</span>' : ''}
                ${a.published === false ? '<span class="badge badge-gray">未发布</span>' : ''}
                <span class="strong truncate" style="font-size:13.5px">${RS.esc(a.title)}</span>
              </div>
              <p class="text-sm muted mt-2" style="white-space:pre-wrap;line-height:1.7">${RS.esc(a.body || '')}</p>
              <div class="text-xs muted-2 mt-2">${RS.when(a.created_at)}</div>
            </div>
            <div class="inline-flex gap-1 shrink-0">
              <button class="btn btn-secondary btn-sm" data-act="toggle">${a.published === false ? '发布' : '下线'}</button>
              <button class="btn btn-secondary btn-sm" data-act="edit">${RS.icon('edit')}</button>
              <button class="btn btn-danger btn-sm" data-act="del">${RS.icon('trash')}</button>
            </div>
          </div>
        </div>`;
      }

      function openForm(a) {
        const editing = !!a;
        const cur = a || { title: '', body: '', level: 'info', pinned: false, published: true };
        const m = RS.modal({
          title: editing ? '编辑公告' : '新建公告',
          body: `
            <div class="field"><label class="input-label">标题</label><input class="input" id="aTitle" value="${RS.esc(cur.title)}" placeholder="例如 10 月 12 日夜间维护"></div>
            <div class="field"><label class="input-label">内容</label><textarea class="textarea" id="aBody" rows="5" style="font-family:inherit;font-size:13px">${RS.esc(cur.body || '')}</textarea></div>
            <div class="grid grid-cols-2 gap-4">
              <div class="field"><label class="input-label">类型</label>
                <select class="select" id="aLevel">
                  <option value="info"${cur.level === 'info' ? ' selected' : ''}>通知</option>
                  <option value="warning"${cur.level === 'warning' ? ' selected' : ''}>提醒</option>
                  <option value="success"${cur.level === 'success' ? ' selected' : ''}>好消息</option>
                </select></div>
              <div class="field"><label class="input-label">选项</label>
                <div class="flex items-center gap-4" style="height:38px">
                  <label class="flex items-center gap-2 text-sm" style="cursor:pointer"><input type="checkbox" id="aPinned" ${cur.pinned ? 'checked' : ''}> 置顶</label>
                  <label class="flex items-center gap-2 text-sm" style="cursor:pointer"><input type="checkbox" id="aPub" ${cur.published !== false ? 'checked' : ''}> 立即发布</label>
                </div></div>
            </div>
            <p class="field-error" id="aErr"></p>`,
          footer: `<button class="btn btn-secondary" data-cancel>取消</button><button class="btn btn-primary" id="aSave">${editing ? '保存' : '创建'}</button>`
        });
        m.querySelector('[data-cancel]').addEventListener('click', RS.closeModal);
        m.querySelector('#aSave').addEventListener('click', async ev => {
          const btn = ev.currentTarget;
          const payload = { title: m.querySelector('#aTitle').value.trim() || '公告', body: m.querySelector('#aBody').value, level: m.querySelector('#aLevel').value, pinned: m.querySelector('#aPinned').checked, published: m.querySelector('#aPub').checked };
          btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
          try {
            if (editing) await RS.api('announcements/' + encodeURIComponent(a.id), { method: 'PATCH', body: payload });
            else await RS.api('announcements', { method: 'POST', body: payload });
            RS.closeModal(); RS.toast('已保存'); await load();
          } catch (err) { m.querySelector('#aErr').textContent = err.message; btn.disabled = false; btn.textContent = '保存'; }
        });
      }

      await load();
    }
  };
})();
