/* ==========================================================================
   app.js — OneGate 控制台内核
   路由 / 接口 / 侧边栏 / 顶栏 / 登录 / 弹窗 / 提示 / 主题 / 轮询
   ========================================================================== */
(function () {
  'use strict';

  const Ch = window.RSCharts;
  // 管理台静态资源由 `/admin/` 提供，接口与登录挂在根路径下（/admin/login、/admin/api/*）。
  // 这里只推导「静态资源前缀/站点根路径」，拼接接口时不要再叠加资源前缀。
  const ASSET_BASE = new URL('.', document.currentScript?.src || location.href).pathname;
  const ROOT = ASSET_BASE.replace(/admin\/$/, '');
  const API = ROOT + 'admin/api/';
  const Views = (window.RSViews = window.RSViews || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------ 图标 */
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    server: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5 20 3M17 6l2 2M14.5 8.5l2 2"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    terminal: '<path d="m4 7 5 5-5 5"/><path d="M12 17h8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.3-1"/><path d="M2 2l20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13a1 1 0 0 1 1 1v3"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M17 13h.01"/>',
    gauge: '<path d="M12 14 17 9"/><circle cx="12" cy="14" r="8"/><path d="M4 14a8 8 0 0 1 16 0"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    play: '<path d="m7 4 13 8-13 8V4Z"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
    sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'
  };
  function icon(name, cls) {
    const body = P[name] || P.dashboard;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${cls ? ` class="${cls}"` : ''} aria-hidden="true">${body}</svg>`;
  }

  /* ------------------------------------------------------------------ 工具 */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (Ch ? Ch.fmt(n) : String(n || 0));
  const fmtMoney = n => (Ch ? Ch.fmtMoney(n) : String(n || 0));
  const num = n => Number(n || 0).toLocaleString('en-US');
  const pct = (a, b) => (!b ? '—' : ((a / b) * 100).toFixed(1) + '%');
  const ms = n => (n ? num(Math.round(n)) + ' ms' : '—');
  const when = ts => {
    if (!ts) return '—';
    const d = new Date(ts); if (isNaN(d)) return '—';
    const p = x => String(x).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const ago = ts => {
    if (!ts) return '从未';
    const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
    if (s < 60) return Math.round(s) + ' 秒前';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前';
    return Math.round(s / 86400) + ' 天前';
  };
  const statusBadge = st => {
    const n = Number(st);
    if (!n) return '<span class="badge badge-gray">—</span>';
    if (n < 300) return `<span class="badge badge-green"><i class="dot"></i>${n}</span>`;
    if (n < 400) return `<span class="badge badge-blue">${n}</span>`;
    if (n < 500) return `<span class="badge badge-amber"><i class="dot"></i>${n}</span>`;
    return `<span class="badge badge-red"><i class="dot"></i>${n}</span>`;
  };

  const say = msg => { const live = $('#live'); if (live) { live.textContent = ''; setTimeout(() => (live.textContent = msg), 30); } };

  function toast(msg, kind) {
    const root = $('#toastRoot'); if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'ok');
    el.innerHTML = `${icon(kind === 'error' ? 'alert' : 'checkCircle')}<div>${esc(msg)}</div>`;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(12px)'; el.style.transition = 'all .25s'; setTimeout(() => el.remove(), 260); }, 3200);
  }

  function copy(text, btn) {
    const done = () => { if (btn) { const old = btn.innerHTML; btn.innerHTML = icon('check'); setTimeout(() => (btn.innerHTML = old), 1400); } toast('已复制到剪贴板'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选择', 'error'); }
      ta.remove();
    }
  }

  /* ------------------------------------------------------------------ 接口 */
  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401) { const err = new Error('unauthorized'); err.code = 401; throw err; }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || 'HTTP ' + res.status);
      err.code = res.status; throw err;
    }
    return data;
  }

  /* ------------------------------------------------------------------ 状态 */
  const state = {
    view: 'dashboard',
    version: '—',
    state: null,        // /state 快照
    overview: null,     // /overview 快照
    range: '24h',
    collapsed: localStorage.getItem('relay.collapsed') === '1',
    navOpen: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    timers: new Set(),
    booted: false
  };

  const NAV = [
    { title: '工作台', items: [
      { id: 'dashboard', label: '仪表盘', icon: 'dashboard' },
      { id: 'calls', label: '调用记录', icon: 'filter' },
      { id: 'logs', label: '请求日志', icon: 'terminal' }
    ] },
    { title: '客户服务', items: [
      { id: 'users', label: '用户信息', icon: 'users' },
      { id: 'usergroups', label: '用户分组', icon: 'layers' },
      { id: 'customers', label: '用户管理', icon: 'users' },
      { id: 'mail', label: '注册邮件', icon: 'mail' },
      { id: 'payment', label: '收款设置', icon: 'wallet' }
    ] },
    { title: '资源', items: [
      { id: 'channels', label: '渠道管理', icon: 'server' },
      { id: 'sources', label: '模型来源', icon: 'server' },
      { id: 'keys', label: 'API 密钥', icon: 'key' },
      { id: 'models', label: '模型广场', icon: 'layers' },
      { id: 'groups', label: '密钥分组', icon: 'globe' }
    ] },
    { title: '分销', items: [
      { id: 'redeem', label: '兑换码', icon: 'wallet' },
      { id: 'announcements', label: '公告', icon: 'sparkles' }
    ] },
    { title: '数据', items: [
      { id: 'usage', label: '使用记录', icon: 'activity' }
    ] },
    { title: '系统', items: [
      { id: 'settings', label: '设置', icon: 'settings' },
      { id: 'audit', label: '操作日志', icon: 'list' }
    ] }
  ];

  /* ------------------------------------------------------------------ 主题 */
  function applyTheme(mode) {
    const dark = mode === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('relay.theme', dark ? 'dark' : 'light');
    state.theme = dark ? 'dark' : 'light';
    const btn = $('#themeBtn');
    if (btn) btn.innerHTML = icon(dark ? 'sun' : 'moon');
    document.dispatchEvent(new CustomEvent('relay:theme', { detail: state.theme }));
  }

  /* ------------------------------------------------------------------ 登录 */
  function renderLogin(message) {
    setDrawerOpen(false, false);
    closeModal();
    $('#appRoot').hidden = true;
    const root = $('#loginRoot');
    root.hidden = false;
    root.innerHTML = `
      <div class="auth-page">
        <div class="auth-card">
          <div class="auth-logo">${icon('zap')}</div>
          <h1 class="auth-title">欢迎回来</h1>
          <p class="auth-sub">登录OneGate 控制台以继续</p>
          <form id="loginForm" class="auth-form" novalidate>
            <div class="field">
              <label class="input-label" for="adminKey">管理密钥</label>
              <div style="position:relative">
                <input id="adminKey" class="input" type="password" autocomplete="current-password" spellcheck="false" placeholder="粘贴管理密钥" style="padding-right:40px" required>
                <button type="button" id="peekBtn" class="btn btn-ghost btn-icon btn-sm" aria-label="显示密钥"
                  style="position:absolute;right:4px;top:50%;transform:translateY(-50%)">${icon('eye')}</button>
              </div>
              <p class="field-error" id="loginError" role="alert">${esc(message || '')}</p>
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="loginBtn">登录</button>
          </form>
          <div class="auth-badge"><span class="badge badge-teal"><i class="dot"></i>OneGate · 自建 AI 网关</span></div>
          <p class="auth-foot">管理员登录由服务端验证</p>
        </div>
      </div>`;

    const input = $('#adminKey');
    setTimeout(() => input.focus(), 60);
    $('#peekBtn').addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('#peekBtn').innerHTML = icon(show ? 'eyeOff' : 'eye');
    });
    $('#loginForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const key = input.value.trim();
      if (!key) { $('#loginError').textContent = '请输入管理密钥'; return; }
      const btn = $('#loginBtn');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 登录中…';
      try {
        const res = await fetch(ROOT + 'admin/login', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ adminKey: key })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data.error && data.error.message) || ('登录失败（HTTP ' + res.status + '）'));
        }
        root.hidden = true; root.innerHTML = '';
        await boot();
      } catch (err) {
        $('#loginError').textContent = err.message;
        btn.disabled = false; btn.innerHTML = '登录';
        input.select();
      }
    });
  }

  /* ------------------------------------------------------------------ 侧边栏 */
  function renderSidebar() {
    const counts = state.state ? {
      channels: (state.state.channels || []).filter(c => c.enabled !== false).length,
      keys: (state.state.keys || []).length
    } : {};
    const section = s => `
      <div class="sidebar-section">
        <div class="sidebar-section-title">${esc(s.title)}</div>
        ${s.items.map(item => `
          <a class="sidebar-link${item.id === state.view ? ' active' : ''}" href="#/${item.id}" data-nav="${item.id}" title="${esc(item.label)}">
            ${icon(item.icon)}<span>${esc(item.label)}</span>
            ${item.id === 'channels' && counts.channels !== undefined ? `<b class="nav-badge">${counts.channels}</b>` : ''}
            ${item.id === 'keys' && counts.keys !== undefined ? `<b class="nav-badge">${counts.keys}</b>` : ''}
          </a>`).join('')}
      </div>`;

    $('#sidebar').innerHTML = `
      <div class="sidebar-header">
        <a href="#/dashboard" class="brand-logo" title="OneGate 控制台">${icon('zap')}</a>
        <div class="brand-text">
          <a href="#/dashboard" class="brand-name">OneGate 控制台</a>
          <span class="brand-sub">RELAY STATION</span>
        </div>
        <span class="version-badge">v${esc(state.version)}</span>
      </div>
      <nav class="sidebar-nav scrollbar-hide">${NAV.map(section).join('')}</nav>
      <div class="sidebar-foot">
        <button class="sidebar-link" type="button" id="collapseBtn" title="收起导航">${icon('panel')}<span>收起导航</span></button>
        <a class="sidebar-link" href="${ROOT}v1" target="_blank" rel="noopener" title="API 接入地址">${icon('globe')}<span>接入地址</span>${icon('external')}</a>
      </div>`;

    $('#collapseBtn').addEventListener('click', () => {
      if (drawerMedia.matches) { setDrawerOpen(false); return; }
      state.collapsed = !state.collapsed;
      localStorage.setItem('relay.collapsed', state.collapsed ? '1' : '0');
      applyCollapsed();
    });
    $$('[data-nav]', $('#sidebar')).forEach(a => a.addEventListener('click', () => {
      if (drawerMedia.matches) setDrawerOpen(false, false);
    }));
    ensureDrawer();
    syncNavigation();
  }

  const drawerMedia = matchMedia('(max-width: 1023px)');
  let drawerReturnFocus = null;
  let shellOverflow = null;
  let shellEventsBound = false;
  function ensureDrawer() {
    const shell = $('#appRoot');
    if (!shell || $('.sidebar-backdrop', shell)) return;
    const backdrop = document.createElement('button');
    backdrop.type = 'button'; backdrop.className = 'sidebar-backdrop'; backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', '关闭导航'); backdrop.setAttribute('aria-controls', 'sidebar');
    backdrop.hidden = true;
    backdrop.addEventListener('click', () => setDrawerOpen(false));
    shell.appendChild(backdrop);
  }
  function syncNavigation() {
    const shell = $('#appRoot');
    if (!shell) return;
    const mobile = drawerMedia.matches;
    const opened = mobile && state.navOpen && !shell.hidden;
    const modalOpen = !!$('#modalRoot [role="dialog"]');
    const sidebar = $('#sidebar'), main = $('.main', shell), backdrop = $('.sidebar-backdrop', shell), menu = $('#menuBtn');
    shell.classList.toggle('nav-open', opened);
    if (sidebar) sidebar.inert = modalOpen || (mobile && !opened);
    if (main) main.inert = modalOpen || opened;
    if (backdrop) { backdrop.hidden = !opened; backdrop.inert = modalOpen; }
    if (menu) {
      menu.style.display = mobile ? 'inline-flex' : 'none';
      menu.setAttribute('aria-controls', 'sidebar');
      menu.setAttribute('aria-expanded', String(opened));
      menu.setAttribute('aria-label', opened ? '关闭导航' : '打开导航');
    }
    if (opened || modalOpen) {
      if (shellOverflow === null) shellOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else if (shellOverflow !== null) {
      document.body.style.overflow = shellOverflow; shellOverflow = null;
    }
  }
  function setDrawerOpen(open, restoreFocus = true) {
    const wasOpen = state.navOpen;
    state.navOpen = !!open && drawerMedia.matches;
    if (state.navOpen && !wasOpen) drawerReturnFocus = document.activeElement;
    syncNavigation();
    if (state.navOpen && !wasOpen) {
      const items = $$('a[href], button:not([disabled]), [tabindex="0"]', $('#sidebar')).filter(el => el.getClientRects().length);
      items[0]?.focus();
    } else if (wasOpen && !state.navOpen) {
      const focus = drawerReturnFocus;
      drawerReturnFocus = null;
      if (restoreFocus && drawerMedia.matches) (focus?.isConnected ? focus : $('#menuBtn'))?.focus();
    }
  }
  function navigationKeydown(event) {
    if (!drawerMedia.matches || !state.navOpen || event.defaultPrevented || $('#modalRoot [role="dialog"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); setDrawerOpen(false); return; }
    if (event.key !== 'Tab') return;
    const sidebar = $('#sidebar');
    const items = $$('a[href], button:not([disabled]), [tabindex="0"]', sidebar).filter(el => el.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  function applyCollapsed() {
    const shell = $('#appRoot');
    shell.classList.toggle('collapsed', state.collapsed && window.innerWidth >= 1024);
  }

  /* ------------------------------------------------------------------ 顶栏 */
  function renderTopbar(view) {
    const health = state.overview ? state.overview.counts : null;
    $('#topbar').innerHTML = `
      <button class="btn btn-ghost btn-icon" id="menuBtn" aria-label="打开导航" aria-controls="sidebar" aria-expanded="false" style="display:none">${icon('menu')}</button>
      <div class="topbar-title">
        <h1>${esc(view.title || '')}</h1>
        <p>${esc(view.sub || '')}</p>
      </div>
      <div class="topbar-actions">
        <span class="badge badge-green" id="healthPill" title="服务状态"><i class="dot"></i>在线</span>
        ${health ? `<span class="badge badge-gray">渠道 ${health.channels_enabled}/${health.channels}</span>` : ''}
        <button class="btn btn-ghost btn-icon" id="themeBtn" aria-label="切换主题" title="切换主题">${icon(state.theme === 'dark' ? 'sun' : 'moon')}</button>
        <button class="btn btn-ghost btn-icon" id="refreshBtn" aria-label="刷新" title="刷新数据">${icon('refresh')}</button>
        <div style="position:relative">
          <button class="btn btn-secondary btn-sm" id="userBtn" aria-haspopup="menu" aria-expanded="false">
            <span class="brand-logo" style="width:22px;height:22px;border-radius:7px;box-shadow:none">${icon('zap')}</span>
            管理员 ${icon('chevron')}
          </button>
          <div id="userMenu" class="card" hidden
            style="position:absolute;right:0;top:calc(100% + 8px);width:190px;padding:6px;z-index:50">
            <a href="#/settings" class="sidebar-link" style="margin:0;font-size:13px">${icon('settings')}<span>控制台设置</span></a>
            <button class="sidebar-link" id="logoutBtn" style="margin:0;width:100%;font-size:13px;background:none;border:0;cursor:pointer">${icon('logout')}<span>退出登录</span></button>
          </div>
        </div>
      </div>`;

    syncNavigation();
    $('#menuBtn').addEventListener('click', () => setDrawerOpen(!state.navOpen));
    $('#themeBtn').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
    $('#refreshBtn').addEventListener('click', async ev => {
      const btn = ev.currentTarget; btn.disabled = true; btn.style.opacity = '.5';
      try { await refresh(); toast('数据已刷新'); } finally { btn.disabled = false; btn.style.opacity = ''; }
    });
    const userBtn = $('#userBtn'), userMenu = $('#userMenu');
    userBtn.addEventListener('click', () => {
      const open = userMenu.hidden;
      userMenu.hidden = !open;
      userBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', ev => {
      if (!userMenu.hidden && !userMenu.contains(ev.target) && !userBtn.contains(ev.target)) userMenu.hidden = true;
    });
    $('#logoutBtn').addEventListener('click', async () => {
      await fetch(ROOT + 'admin/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      location.reload();
    });
  }

  /* ------------------------------------------------------------------ 轮询 */
  function poll(fn, interval) {
    const id = setInterval(() => { fn().catch(() => {}); }, interval);
    state.timers.add(id);
    return () => { clearInterval(id); state.timers.delete(id); };
  }
  function clearPollers() { state.timers.forEach(clearInterval); state.timers.clear(); }

  /* ------------------------------------------------------------------ 数据 */
  async function loadState() { state.state = await api('state'); state.version = state.state.version || state.version; return state.state; }
  async function loadOverview(range) {
    state.overview = await api('overview?range=' + encodeURIComponent(range || state.range));
    return state.overview;
  }
  async function refresh() {
    await Promise.all([loadState(), loadOverview()]);
    renderSidebar();
    const view = Views[state.view];
    if (view) renderTopbar(view);
    if (state.booted) route(true);
  }

  /* ------------------------------------------------------------------ 路由 */
  function currentView() {
    const id = (location.hash || '').replace(/^#\/?/, '').split('?')[0] || 'dashboard';
    return Views[id] ? id : 'dashboard';
  }

  let routeGeneration = 0;
  async function route(silent) {
    const generation = ++routeGeneration;
    const id = currentView();
    const changed = id !== state.view || silent;
    state.view = id;
    const view = Views[id];
    clearPollers();
    closeModal();
    setDrawerOpen(false, false);
    $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === id));
    renderTopbar(view);
    const container = $('#view');
    const host = document.createElement('div');
    host.dataset.viewHost = id;
    if (!silent) host.innerHTML = `<div class="loading-block"><span class="spinner"></span> 加载中…</div>`;
    container.replaceChildren(host);
    const active = () => generation === routeGeneration && host.isConnected;
    const viewPoll = (fn, interval) => active() ? poll(async () => {
      if (active()) await fn();
    }, interval) : () => {};
    try {
      await view.mount(host, { state, api, refresh, poll: viewPoll, charts: Ch });
    } catch (err) {
      if (!active()) return;
      if (err && err.code === 401) { renderLogin('会话已过期，请重新登录'); return; }
      host.innerHTML = `<div class="empty">${icon('alert')}<b>加载失败</b><span>${esc(err.message || err)}</span></div>`;
    }
    if (active() && changed) container.scrollTop = 0;
  }

  function go(id) { location.hash = '#/' + id; }

  /* ------------------------------------------------------------------ 弹窗 */
  let modalCleanup = null;
  let modalDismiss = null;
  let modalReturnFocus = null;
  function modal({ title, sub, body, footer, wide, onClose }) {
    closeModal();
    const root = $('#modalRoot');
    modalReturnFocus = document.activeElement;
    modalDismiss = onClose;
    root.innerHTML = `
      <div class="modal-overlay" data-close>
        <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
          <div class="modal-header">
            <div><div class="modal-title">${esc(title || '')}</div>${sub ? `<div class="modal-sub">${esc(sub)}</div>` : ''}</div>
            <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="关闭">${icon('x')}</button>
          </div>
          <div class="modal-body">${body || ''}</div>
          ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
        </div>
      </div>`;
    const overlay = $('.modal-overlay', root);
    const dialog = $('[role="dialog"]', root);
    dialog.tabIndex = -1;
    const dismissClick = event => {
      if (event.target === overlay || event.target.closest('button[data-close]')) closeModal();
    };
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
      if (event.key !== 'Tab') return;
      const items = $$('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]', dialog).filter(el => el.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    root.addEventListener('click', dismissClick);
    document.addEventListener('keydown', keydown);
    modalCleanup = () => {
      root.removeEventListener('click', dismissClick);
      document.removeEventListener('keydown', keydown);
    };
    syncNavigation();
    const first = $('input, textarea, select, button', dialog) || dialog;
    queueMicrotask(() => { if (dialog.isConnected) first.focus(); });
    return root;
  }
  function closeModal() {
    const cleanup = modalCleanup, dismiss = modalDismiss, focus = modalReturnFocus;
    modalCleanup = null; modalDismiss = null; modalReturnFocus = null;
    if (cleanup) cleanup();
    $('#modalRoot').innerHTML = '';
    syncNavigation();
    if (focus && focus.isConnected) focus.focus();
    if (dismiss) dismiss();
  }
  function confirmDialog({ title, message, danger, confirmText }) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      const root = modal({
        title,
        body: `<p style="font-size:13.5px;line-height:1.7;color:var(--text-3)">${esc(message)}</p>`,
        footer: `<button class="btn btn-secondary" data-cancel>取消</button>
                 <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText || '确认')}</button>`,
        onClose: () => finish(false)
      });
      const done = v => { finish(v); closeModal(); };
      $('[data-ok]', root).addEventListener('click', () => done(true));
      $('[data-cancel]', root).addEventListener('click', () => done(false));
    });
  }

  /* ------------------------------------------------------------------ 引导 */
  async function boot() {
    try {
      await loadState();
    } catch (err) {
      if (err.code === 401) { renderLogin(); return; }
      renderLogin('无法连接控制台接口：' + err.message);
      return;
    }
    $('#loginRoot').hidden = true;
    $('#appRoot').hidden = false;
    state.booted = true;
    state.version = state.state.version || '1.0.0';
    renderSidebar();
    applyCollapsed();
    if (!shellEventsBound) {
      shellEventsBound = true;
      window.addEventListener('resize', () => { applyCollapsed(); syncNavigation(); });
      drawerMedia.addEventListener('change', () => { setDrawerOpen(false, false); applyCollapsed(); syncNavigation(); });
      document.addEventListener('keydown', navigationKeydown);
      window.addEventListener('hashchange', () => route());
    }
    loadOverview().catch(() => {});
    route();
    // 全局心跳：20s 刷新一次快照，供侧边栏计数与顶栏健康状态使用
    poll(async () => {
      await loadState();
      $$('[data-nav="channels"] .nav-badge').forEach(b => (b.textContent = (state.state.channels || []).filter(c => c.enabled !== false).length));
      $$('[data-nav="keys"] .nav-badge').forEach(b => (b.textContent = (state.state.keys || []).length));
    }, 20000);
  }

  window.RS = {
    state, api, BASE: ROOT, ASSET_BASE, API, Views,
    icon, esc, fmt, fmtMoney, num, pct, ms, when, ago, statusBadge, say, toast, copy,
    modal, closeModal, confirmDialog, poll, go, refresh, loadState, loadOverview,
    theme: () => state.theme, applyTheme
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
