/* OneGate console motion helpers: original code written for this project. */
(function () {
  'use strict';
  if (window.RelayOriginalMotion) return;
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set();
  let timer = null;
  let previousRoute = null;
  let previousFilter = '';
  let lastLogin = null;
  let marker = null;
  let navHost = null;
  let lastMarker = '';

  const active = () => !media.matches && !document.hidden;
  function syncPreference() {
    root.dataset.rsMotion = media.matches ? 'reduced' : document.hidden ? 'paused' : 'active';
    if (!active()) {
      animations.forEach(animation => animation.cancel());
      animations.clear();
    }
  }
  function animate(element, keyframes, options) {
    if (!active() || !element || !element.animate) return;
    const animation = element.animate(keyframes, options);
    animations.add(animation);
    const release = () => animations.delete(animation);
    animation.addEventListener('finish', release, { once: true });
    animation.addEventListener('cancel', release, { once: true });
  }
  function routeName() {
    const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
    return hash || window.RS?.state?.view || 'dashboard';
  }
  function filterKey(view) {
    return [...view.querySelectorAll('input:not([type=password]):not([type=hidden]), select, .segmented .active')]
      .map(element => element.matches('input, select') ? `${element.id}:${element.value}` : element.textContent.trim())
      .join('|');
  }
  function prepareModelCards(view) {
    view.querySelectorAll('[data-copy-model]').forEach(button => button.closest('.card')?.classList.add('rs-model-tile'));
  }
  function animateView(view, local) {
    const targets = local
      ? [...view.querySelectorAll('.rs-model-tile, tbody tr')].slice(0, 8)
      : [...view.querySelectorAll('.page-stack > .card, .page-stack > .grid > .card')].slice(0, 14);
    targets.forEach((element, index) => {
      if (local) element.classList.add('rs-filter-arrive');
      animate(element, [{ opacity: .15, transform: `translateY(${local ? 7 : 14}px)` }, { opacity: 1, transform: 'translateY(0)' }], {
        duration: local ? 280 : 520,
        delay: Math.min(index, local ? 5 : 7) * (local ? 28 : 42),
        easing: 'cubic-bezier(.22,.8,.22,1)',
        fill: 'backwards'
      });
    });
    if (!local) view.querySelectorAll('.chart-box').forEach((element, index) => {
      element.classList.add('rs-chart-enter');
      animate(element, [{ opacity: .1, transform: 'translateY(8px) scaleY(.96)' }, { opacity: 1, transform: 'translateY(0) scaleY(1)' }], {
        duration: 740, delay: 180 + index * 60, easing: 'cubic-bezier(.22,.8,.22,1)'
      });
    });
  }
  function ensureSidebarWatcher(host) {
    if (host.dataset.rsMarkerWatch) return;
    host.dataset.rsMarkerWatch = '1';
    const observer = new MutationObserver(schedule);
    observer.observe(host, { subtree: true, attributes: true, attributeFilter: ['class'] });
    host.addEventListener('scroll', ensureNavigation, { passive: true });
  }
  function ensureNavigation() {
    const host = document.querySelector('#sidebar .sidebar-nav');
    if (!host) return;
    if (navHost !== host || !marker?.isConnected) {
      navHost = host;
      marker = document.createElement('span');
      marker.className = 'rs-nav-marker';
      marker.setAttribute('aria-hidden', 'true');
      host.prepend(marker);
      lastMarker = '';
    }
    ensureSidebarWatcher(host);
    const link = host.querySelector('.sidebar-link.active');
    if (!link) { marker.style.opacity = '0'; return; }
    const hostRect = host.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const top = linkRect.top - hostRect.top + host.scrollTop;
    const value = `${Math.round(top)}:${Math.round(linkRect.height)}`;
    if (value !== lastMarker) {
      marker.style.height = `${linkRect.height}px`;
      marker.style.transform = `translateY(${top}px)`;
      marker.style.opacity = '1';
      lastMarker = value;
    }
  }
  function ensureLogin() {
    const page = document.querySelector('#loginRoot:not([hidden]) .auth-page');
    if (!page) return;
    if (!page.querySelector('.rs-orbit-scene')) {
      const scene = document.createElement('div');
      scene.className = 'rs-orbit-scene';
      scene.setAttribute('aria-hidden', 'true');
      // This geometry is a product illustration. It has no live metrics or status.
      scene.innerHTML = `<svg class="rs-orbit-art" viewBox="0 0 520 420" fill="none"><path class="rs-orbit-grid" d="M60 210H460M260 44V376"/><ellipse class="rs-orbit-ring" cx="260" cy="210" rx="170" ry="130"/><ellipse class="rs-orbit-ring" cx="260" cy="210" rx="208" ry="163"/><path class="rs-orbit-track" d="M86 210H214M306 210H434M260 80V164M260 256V340"/><path class="rs-orbit-packet" d="M86 210H214M306 210H434"/><path class="rs-orbit-packet second" d="M260 80V164M260 256V340"/><g class="rs-orbit-satellite"><circle class="rs-orbit-dot" cx="430" cy="210" r="4"/><circle class="rs-orbit-dot" cx="90" cy="210" r="3"/></g><g class="rs-orbit-satellite reverse"><circle class="rs-orbit-dot" cx="260" cy="47" r="3"/></g><rect class="rs-orbit-node" x="64" y="188" width="44" height="44" rx="11"/><path class="rs-orbit-hub-symbol" d="M80 203l7 7-7 7M89 217h8" style="stroke:#7b8fba"/><rect class="rs-orbit-node" x="412" y="188" width="44" height="44" rx="11"/><path class="rs-orbit-hub-symbol" d="M424 204h20M424 211h20M424 218h13" style="stroke:#7b8fba"/><rect class="rs-orbit-node" x="238" y="58" width="44" height="44" rx="11"/><circle cx="260" cy="80" r="7" stroke="#7b8fba"/><rect class="rs-orbit-node" x="238" y="318" width="44" height="44" rx="11"/><path d="M250 340h20M260 330v20" stroke="#7b8fba"/><rect class="rs-orbit-hub" x="214" y="164" width="92" height="92" rx="22"/><path class="rs-orbit-hub-symbol rs-orbit-center" d="M236 211h13l8-18 10 34 8-16h9"/></svg><p>从一个入口，<br>连接每一条路径。</p><small>CHENGLIU · OPERATIONS</small>`;
      page.prepend(scene);
    }
    if (lastLogin !== page) {
      lastLogin = page;
      animate(page.querySelector('.auth-card'), [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], {
        duration: 620, easing: 'cubic-bezier(.22,.8,.22,1)'
      });
    }
  }
  function scan() {
    timer = null;
    syncPreference();
    ensureLogin();
    ensureNavigation();
    const view = document.querySelector('#view');
    if (document.querySelector('#appRoot')?.hidden) { previousRoute = null; previousFilter = ''; return; }
    if (!view || !view.querySelector('.card')) return;
    prepareModelCards(view);
    const route = routeName();
    const filter = filterKey(view);
    if (route !== previousRoute) {
      animateView(view, false);
      previousRoute = route;
      previousFilter = filter;
    } else if (filter !== previousFilter) {
      animateView(view, true);
      previousFilter = filter;
    }
  }
  function schedule() {
    if (timer === null) timer = setTimeout(scan, 35);
  }
  function init() {
    syncPreference();
    const observer = new MutationObserver(schedule);
    ['#view', '#sidebar', '#loginRoot'].forEach(selector => {
      const element = document.querySelector(selector);
      if (element) observer.observe(element, { subtree: true, childList: true });
    });
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    document.addEventListener('visibilitychange', syncPreference);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('resize', schedule);
    media.addEventListener ? media.addEventListener('change', syncPreference) : media.addListener(syncPreference);
    scan();
  }
  window.RelayOriginalMotion = { scan: schedule, activeCount: () => animations.size };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
