/* ==========================================================================
   charts.js — 极简 Canvas 图表（折线/面积、环图、迷你折线、柱状）
   导出 window.RSCharts
   ========================================================================== */
(function () {
  'use strict';

  const C = {
    teal: '#14b8a6',
    tealLight: '#2dd4bf',
    blue: '#3b82f6',
    amber: '#f59e0b',
    violet: '#8b5cf6',
    rose: '#f43f5e',
    emerald: '#10b981',
    slate: '#94a3b8',
    grid: 'rgba(148,163,184,.18)',
    axis: 'rgba(148,163,184,.5)'
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fit(canvas, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.parentElement.clientWidth || canvas.clientWidth || 300;
    const h = cssHeight || canvas.parentElement.clientHeight || 180;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = '100%';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  const fmt = n => {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    if (Math.abs(n) >= 1e3) return n.toLocaleString('en-US');
    return String(Math.round(n * 100) / 100);
  };

  function fmtMoney(n) {
    n = Number(n) || 0;
    if (n === 0) return '0';
    if (n < 0.01) return n.toFixed(4);
    if (n < 1) return n.toFixed(3);
    return n.toFixed(2);
  }

  function niceMax(value) {
    if (!value || value <= 0) return 4;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const norm = value / base;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * base;
  }

  /* ---------------------------------------------------------------- 折线/面积 */
  function line(canvas, options) {
    const points = options.points || [];
    const series = (options.series || []).filter(s => !s.hidden);
    const { ctx, w, h } = fit(canvas, options.height || 200);
    if (!points.length || !series.length) { drawEmpty(ctx, w, h); return null; }

    const padL = 44, padR = series.some(s => s.axis === 'right') ? 46 : 14, padT = 14, padB = 26;
    const plotW = Math.max(10, w - padL - padR), plotH = Math.max(10, h - padT - padB);
    const left = series.filter(s => s.axis !== 'right');
    const right = series.filter(s => s.axis === 'right');
    const maxL = niceMax(Math.max(1, ...left.flatMap(s => s.values.map(v => Number(v) || 0))));
    const maxR = niceMax(Math.max(1, ...right.flatMap(s => s.values.map(v => Number(v) || 0))));
    const xAt = i => padL + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
    const yAt = (v, axis) => padT + plotH - (plotH * Math.min(1, Math.max(0, (Number(v) || 0) / (axis === 'right' ? maxR : maxL))));

    // 网格与刻度
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = C.axis; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(fmt(maxL * (1 - i / 4)), padL - 8, y);
    }
    if (right.length) {
      ctx.textAlign = 'left';
      for (let i = 0; i <= 4; i++) {
        const y = padT + (plotH * i) / 4;
        ctx.fillText(fmt(maxR * (1 - i / 4)), padL + plotW + 8, y);
      }
    }

    // X 轴标签
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.ceil(points.length / Math.max(3, Math.floor(plotW / 74))));
    points.forEach((label, i) => {
      if (i % step !== 0 && i !== points.length - 1) return;
      ctx.fillText(label, xAt(i), padT + plotH + 8);
    });

    // 序列
    series.forEach((s, idx) => {
      const color = s.color || [C.teal, C.violet, C.amber, C.blue][idx % 4];
      const values = s.values.map(v => Number(v) || 0);
      ctx.beginPath();
      values.forEach((v, i) => { const x = xAt(i), y = yAt(v, s.axis); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();

      if (s.area !== false && idx === 0) {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, hexA(color, .26));
        grad.addColorStop(1, hexA(color, 0));
        ctx.lineTo(xAt(values.length - 1), padT + plotH);
        ctx.lineTo(xAt(0), padT + plotH);
        ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      }
    });

    // 悬浮提示
    const tip = options.tooltip;
    return function move(evt) {
      if (!tip) return;
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      let idx = Math.round(((x - padL) / plotW) * (points.length - 1));
      idx = Math.max(0, Math.min(points.length - 1, idx));
      const px = xAt(idx);
      ctx.clearRect(0, 0, w, h);
      line(canvas, { ...options, tooltip: null });
      const c2 = canvas.getContext('2d');
      c2.setLineDash([4, 4]); c2.strokeStyle = C.axis; c2.beginPath();
      c2.moveTo(px, padT); c2.lineTo(px, padT + plotH); c2.stroke(); c2.setLineDash([]);
      series.forEach((s, i) => {
        const color = s.color || [C.teal, C.violet, C.amber, C.blue][i % 4];
        c2.beginPath(); c2.arc(px, yAt(s.values[idx], s.axis), 3.5, 0, Math.PI * 2);
        c2.fillStyle = color; c2.fill(); c2.strokeStyle = '#fff'; c2.lineWidth = 1.5; c2.stroke();
      });
      const rows = series.map(s => `<div><span style="color:${s.color || C.teal}">●</span> ${escapeHtml(s.name)} <b>${s.money ? fmtMoney(s.values[idx]) : fmt(s.values[idx])}</b></div>`).join('');
      tip.innerHTML = `<div style="margin-bottom:3px;color:var(--muted)">${escapeHtml(points[idx])}</div>${rows}`;
      tip.classList.add('show');
      const tw = tip.offsetWidth || 120;
      tip.style.left = Math.min(Math.max(px - tw / 2, 0), w - tw) + 'px';
      tip.style.top = '2px';
    };
  }

  function drawEmpty(ctx, w, h) {
    ctx.fillStyle = C.axis; ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('暂无数据', w / 2, h / 2);
  }

  function hexA(hex, alpha) {
    const m = hex.replace('#', '');
    const n = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------------------------------------------------------- 环图 */
  function donut(canvas, items, opts = {}) {
    const { ctx, w, h } = fit(canvas, opts.height || 168);
    const total = items.reduce((a, b) => a + (Number(b.value) || 0), 0);
    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2 - 8;
    const thickness = opts.thickness || Math.max(14, radius * 0.38);
    if (!total) {
      ctx.beginPath(); ctx.arc(cx, cy, radius - thickness / 2, 0, Math.PI * 2);
      ctx.strokeStyle = C.grid; ctx.lineWidth = thickness; ctx.stroke();
      drawEmpty(ctx, w, h);
      return;
    }
    let start = -Math.PI / 2;
    items.forEach((item, i) => {
      const angle = (Number(item.value) || 0) / total * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - thickness / 2, start + 0.012, start + angle - 0.012);
      ctx.strokeStyle = item.color || [C.teal, C.blue, C.violet, C.amber, C.rose, C.emerald][i % 6];
      ctx.lineWidth = thickness; ctx.lineCap = 'butt'; ctx.stroke();
      start += angle;
    });
    ctx.fillStyle = 'var(--text)';
    ctx.font = '600 19px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    if (document.documentElement.classList.contains('dark')) ctx.fillStyle = '#f8fafc';
    ctx.fillText(opts.centerLabel || fmt(total), cx, cy - (opts.centerSub ? 7 : 0));
    if (opts.centerSub) {
      ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#94a3b8';
      ctx.fillText(opts.centerSub, cx, cy + 11);
    }
  }

  /* ---------------------------------------------------------------- 迷你折线 */
  function spark(canvas, values, color) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.parentElement.clientWidth || 74, h = canvas.parentElement.clientHeight || 24;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = '100%'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const data = (values || []).map(v => Number(v) || 0);
    if (data.length < 2) return;
    const max = Math.max(...data, 1), min = 0;
    const xAt = i => (w * i) / (data.length - 1);
    const yAt = v => h - 2 - ((h - 4) * (v - min)) / (max - min || 1);
    ctx.beginPath(); data.forEach((v, i) => (i ? ctx.lineTo(xAt(i), yAt(v)) : ctx.moveTo(xAt(i), yAt(v))));
    ctx.strokeStyle = color || C.teal; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, hexA(color || C.teal, .22)); grad.addColorStop(1, hexA(color || C.teal, 0));
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }

  /* ---------------------------------------------------------------- 横向柱状 */
  function bars(canvas, items, opts = {}) {
    const { ctx, w } = fit(canvas, opts.height || Math.max(60, items.length * 30));
    const max = Math.max(1, ...items.map(i => Number(i.value) || 0));
    const labelW = opts.labelWidth || 120;
    items.forEach((item, i) => {
      const y = i * 30 + 8;
      ctx.fillStyle = '#94a3b8'; ctx.font = '11.5px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(item.label).slice(0, 22), 0, y + 5);
      const bw = Math.max(2, ((w - labelW - 46) * (Number(item.value) || 0)) / max);
      ctx.fillStyle = 'rgba(148,163,184,.16)';
      roundRect(ctx, labelW, y - 4, w - labelW - 46, 12, 6); ctx.fill();
      ctx.fillStyle = item.color || C.teal;
      roundRect(ctx, labelW, y - 4, bw, 12, 6); ctx.fill();
      ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'right';
      ctx.fillText(opts.format ? opts.format(item.value) : fmt(item.value), w, y + 5);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  window.RSCharts = { line, donut, spark, bars, fmt, fmtMoney, colors: C };
})();
