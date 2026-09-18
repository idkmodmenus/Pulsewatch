/**
 * PulseWatch — components.js
 * Reusable UI components: Toast, Modal, Sidebar, Topbar, Pagination,
 * Search, Empty/Error states, Connection indicator.
 */

'use strict';

import { esc, timeAgo } from './utils.js';

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastContainer = null;

function getToastContainer() {
  if (_toastContainer) return _toastContainer;
  _toastContainer = document.createElement('div');
  _toastContainer.className = 'toast-container';
  _toastContainer.setAttribute('aria-live', 'polite');
  _toastContainer.setAttribute('aria-atomic', 'false');
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

export function toast(message, type = 'info', duration = 4000) {
  const container = getToastContainer();
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.setAttribute('role', 'alert');
  t.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${toastIcon(type)}</span>
    <span class="toast__msg">${esc(message)}</span>
    <button class="toast__close" aria-label="Dismiss">&times;</button>`;
  t.querySelector('.toast__close').addEventListener('click', () => dismiss(t));
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--visible'));
  if (duration > 0) setTimeout(() => dismiss(t), duration);
  return t;
}

function dismiss(t) {
  t.classList.remove('toast--visible');
  t.addEventListener('transitionend', () => t.remove(), { once: true });
}

function toastIcon(type) {
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };
  return icons[type] ?? icons.info;
}

export const Toast = { success: (m,d) => toast(m,'success',d), error: (m,d) => toast(m,'error',d), warn: (m,d) => toast(m,'warn',d), info: (m,d) => toast(m,'info',d) };

// ─── Modal ────────────────────────────────────────────────────────────────────
export class Modal {
  constructor({ id, title, content, footer, size = 'md', onClose } = {}) {
    this.id      = id ?? 'modal-' + Math.random().toString(36).slice(2);
    this._onClose = onClose;
    this._el = this._build(title, content, footer, size);
    document.body.appendChild(this._el);
    this._el.addEventListener('click', (e) => {
      if (e.target === this._el) this.close();
    });
    document.addEventListener('keydown', this._keyHandler = (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  _build(title, content, footer, size) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.id = this.id;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', this.id + '-title');
    wrap.innerHTML = `
      <div class="modal modal--${esc(size)}">
        <div class="modal__header">
          <h2 class="modal__title" id="${esc(this.id)}-title">${esc(title ?? '')}</h2>
          <button class="modal__close" aria-label="Close">&times;</button>
        </div>
        <div class="modal__body">${content ?? ''}</div>
        ${footer ? `<div class="modal__footer">${footer}</div>` : ''}
      </div>`;
    wrap.querySelector('.modal__close').addEventListener('click', () => this.close());
    return wrap;
  }

  open() {
    this._el.classList.add('modal-backdrop--open');
    document.body.classList.add('modal-open');
    const first = this._el.querySelector('input, select, textarea, button:not(.modal__close)');
    first?.focus();
  }

  close() {
    this._el.classList.remove('modal-backdrop--open');
    document.body.classList.remove('modal-open');
    this._onClose?.();
  }

  setContent(html) {
    this._el.querySelector('.modal__body').innerHTML = html;
  }

  setTitle(t) {
    this._el.querySelector('.modal__title').textContent = t;
  }

  destroy() {
    document.removeEventListener('keydown', this._keyHandler);
    this._el.remove();
  }

  get el() { return this._el; }
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────
export function confirm(message, { title = 'Confirm', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = new Modal({
      title,
      size: 'sm',
      content: `<p class="modal-confirm__msg">${esc(message)}</p>`,
      footer: `
        <button class="btn btn--ghost modal-cancel">Cancel</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'} modal-confirm">${esc(confirmText)}</button>`,
      onClose: () => { m.destroy(); resolve(false); },
    });
    m.el.querySelector('.modal-cancel').addEventListener('click', () => { m.close(); m.destroy(); resolve(false); });
    m.el.querySelector('.modal-confirm').addEventListener('click', () => { m.close(); m.destroy(); resolve(true); });
    m.open();
  });
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function emptyState({ icon = '', title, message, action = '' } = {}) {
  return `
    <div class="empty-state">
      ${icon ? `<div class="empty-state__icon">${icon}</div>` : ''}
      <h3 class="empty-state__title">${esc(title ?? 'No data')}</h3>
      ${message ? `<p class="empty-state__msg">${esc(message)}</p>` : ''}
      ${action}
    </div>`;
}

// ─── Error state ──────────────────────────────────────────────────────────────
export function errorState(err, retryFn = null) {
  const msg = err?.message ?? 'Something went wrong.';
  const retryBtn = retryFn
    ? `<button class="btn btn--ghost error-retry-btn">Retry</button>`
    : '';
  const html = `
    <div class="error-state">
      <div class="error-state__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <h3 class="error-state__title">Failed to load</h3>
      <p class="error-state__msg">${esc(msg)}</p>
      ${retryBtn}
    </div>`;
  if (retryFn) {
    // attach after DOM insertion — caller must call bindRetry
  }
  return { html, bindRetry(container) {
    container?.querySelector('.error-retry-btn')?.addEventListener('click', retryFn);
  }};
}

// ─── Connection banner ────────────────────────────────────────────────────────
let _connBanner = null;
export function showOfflineBanner(lastUpdated) {
  if (_connBanner) return;
  _connBanner = document.createElement('div');
  _connBanner.className = 'offline-banner';
  _connBanner.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
      <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/>
    </svg>
    <span>Backend connection lost — last updated: <strong id="offline-last-updated">${lastUpdated ? timeAgo(lastUpdated) : 'unknown'}</strong></span>
    <button class="offline-banner__close" aria-label="Dismiss">&times;</button>`;
  _connBanner.querySelector('.offline-banner__close').addEventListener('click', hideOfflineBanner);
  document.body.prepend(_connBanner);
}

export function hideOfflineBanner() {
  _connBanner?.remove();
  _connBanner = null;
}

export function updateOfflineBannerTime(lastUpdated) {
  const el = document.getElementById('offline-last-updated');
  if (el && lastUpdated) el.textContent = timeAgo(lastUpdated);
}

// ─── Sidebar active state ─────────────────────────────────────────────────────
export function markActiveSidebarLink() {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar__link').forEach(link => {
    const href = link.getAttribute('href');
    const isActive = href && (path.endsWith(href) || (href !== '/index.html' && path.includes(href.replace('.html', ''))));
    link.classList.toggle('sidebar__link--active', !!isActive);
    if (isActive) link.closest('.sidebar__item')?.classList.add('sidebar__item--active');
  });
}

// ─── Sidebar toggle ───────────────────────────────────────────────────────────
export function initSidebar() {
  const sidebar   = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  const overlay   = document.getElementById('sidebar-overlay');
  if (!sidebar) return;

  const collapsed = localStorage.getItem('pw-sidebar-collapsed') === 'true';
  if (collapsed) sidebar.classList.add('sidebar--collapsed');

  toggleBtn?.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('sidebar--collapsed');
    localStorage.setItem('pw-sidebar-collapsed', String(isCollapsed));
    overlay?.classList.toggle('sidebar-overlay--visible', !isCollapsed && window.innerWidth < 768);
  });

  overlay?.addEventListener('click', () => {
    sidebar.classList.add('sidebar--collapsed');
    overlay.classList.remove('sidebar-overlay--visible');
  });

  markActiveSidebarLink();
}

// ─── Topbar: global search ────────────────────────────────────────────────────
export function initGlobalSearch() {
  const input = document.getElementById('global-search');
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) window.location.href = `monitors.html?q=${encodeURIComponent(q)}`;
    }
  });
  // Ctrl/Cmd+K shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ─── Pagination ───────────────────────────────────────────────────────────────
export class Pagination {
  constructor({ container, total, pageSize = 50, onChange }) {
    this._container = typeof container === 'string' ? document.getElementById(container) : container;
    this._total    = total ?? 0;
    this._pageSize = pageSize;
    this._page     = 1;
    this._onChange = onChange;
  }

  set total(n) { this._total = n; this.render(); }
  get page()   { return this._page; }
  get offset() { return (this._page - 1) * this._pageSize; }

  render() {
    if (!this._container) return;
    const pages = Math.ceil(this._total / this._pageSize);
    if (pages <= 1) { this._container.innerHTML = ''; return; }
    const p = this._page;
    const mkBtn = (label, pg, disabled = false, active = false) =>
      `<button class="pagination__btn${active?' pagination__btn--active':''}${disabled?' pagination__btn--disabled':''}"
        data-page="${pg}" ${disabled ? 'disabled aria-disabled="true"' : ''} aria-label="Page ${pg}">${esc(String(label))}</button>`;

    let btns = mkBtn('‹', p - 1, p <= 1);
    const range = this._pageRange(p, pages);
    let prev = null;
    for (const pg of range) {
      if (prev !== null && pg - prev > 1) btns += '<span class="pagination__ellipsis">…</span>';
      btns += mkBtn(pg, pg, false, pg === p);
      prev = pg;
    }
    btns += mkBtn('›', p + 1, p >= pages);
    this._container.innerHTML = `<nav class="pagination" aria-label="Pagination">${btns}<span class="pagination__info">${this._total.toLocaleString()} items</span></nav>`;
    this._container.querySelector('.pagination').addEventListener('click', (e) => {
      const btn = e.target.closest('.pagination__btn');
      if (!btn || btn.disabled) return;
      const pg = parseInt(btn.dataset.page, 10);
      if (pg >= 1 && pg <= pages && pg !== this._page) {
        this._page = pg;
        this.render();
        this._onChange?.(this._page, this.offset);
      }
    });
  }

  _pageRange(current, total) {
    const delta = 2;
    const range = new Set([1, total]);
    for (let i = current - delta; i <= current + delta; i++) {
      if (i >= 1 && i <= total) range.add(i);
    }
    return [...range].sort((a, b) => a - b);
  }

  reset() { this._page = 1; this.render(); }
}

// ─── Sort headers ─────────────────────────────────────────────────────────────
export function initSortHeaders(tableEl, onSort) {
  tableEl?.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.add('sortable');
    th.setAttribute('tabindex', '0');
    th.setAttribute('aria-sort', 'none');
    th.addEventListener('click', () => triggerSort(th));
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') triggerSort(th); });
  });

  function triggerSort(th) {
    const key = th.dataset.sort;
    const current = th.getAttribute('aria-sort');
    const dir = current === 'ascending' ? 'desc' : 'asc';
    tableEl.querySelectorAll('th[data-sort]').forEach(h => h.setAttribute('aria-sort', 'none'));
    th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    onSort?.(key, dir);
  }
}

// ─── Resource gauge bar ───────────────────────────────────────────────────────
export function gaugeBar(pct, warnAt = 75, critAt = 90) {
  const n = parseFloat(pct) || 0;
  const cls = n >= critAt ? 'gauge--danger' : n >= warnAt ? 'gauge--warn' : 'gauge--ok';
  return `
    <div class="gauge" role="progressbar" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="100">
      <div class="gauge__track">
        <div class="gauge__fill ${cls}" style="width:${Math.min(100,n)}%"></div>
      </div>
      <span class="gauge__label">${Math.round(n)}%</span>
    </div>`;
}

// ─── Sparkline (inline SVG) ───────────────────────────────────────────────────
export function sparkline(points, { width = 80, height = 24, color = 'var(--color-accent)' } = {}) {
  if (!points?.length) return `<svg width="${width}" height="${height}"></svg>`;
  const valid = points.filter(p => typeof p === 'number' && isFinite(p));
  if (!valid.length) return `<svg width="${width}" height="${height}"></svg>`;
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = max - min || 1;
  const step = width / (valid.length - 1 || 1);
  const pts = valid.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// ─── Uptime bar (90-day style blocks) ────────────────────────────────────────
export function uptimeBars(history) {
  if (!history?.length) return '<div class="uptime-bars uptime-bars--empty"></div>';
  const bars = history.slice(-90).map(d => {
    const u = parseFloat(d.uptime ?? 100);
    const cls = u >= 99.9 ? 'bar--up' : u >= 95 ? 'bar--degraded' : 'bar--down';
    const label = d.day ? new Date(d.day).toLocaleDateString() : '';
    return `<span class="uptime-bar ${cls}" title="${label}: ${u.toFixed(2)}%"></span>`;
  }).join('');
  return `<div class="uptime-bars" aria-label="90-day uptime history">${bars}</div>`;
}

// ─── Timing breakdown bar ─────────────────────────────────────────────────────
export function timingBreakdown(timings) {
  if (!timings) return '<div class="timing-empty">No timing data</div>';
  const steps = [
    { key: 'dns',      label: 'DNS Lookup',        color: 'var(--timing-dns)'  },
    { key: 'tcp',      label: 'TCP Connect',        color: 'var(--timing-tcp)'  },
    { key: 'tls',      label: 'TLS Handshake',      color: 'var(--timing-tls)'  },
    { key: 'ttfb',     label: 'Server Processing',  color: 'var(--timing-ttfb)' },
    { key: 'download', label: 'Download',            color: 'var(--timing-dl)'   },
  ];
  const total = steps.reduce((s, st) => s + (parseFloat(timings[st.key]) || 0), 0) || 1;
  const rows = steps.map(st => {
    const ms  = parseFloat(timings[st.key]) || 0;
    const pct = (ms / total * 100).toFixed(1);
    return `
      <div class="timing-row">
        <span class="timing-row__label">${esc(st.label)}</span>
        <div class="timing-row__bar-wrap">
          <div class="timing-row__bar" style="width:${pct}%;background:${st.color}"></div>
        </div>
        <span class="timing-row__val">${ms > 0 ? Math.round(ms) + ' ms' : '—'}</span>
      </div>`;
  }).join('');
  return `<div class="timing-breakdown">${rows}
    <div class="timing-row timing-row--total">
      <span class="timing-row__label">Total</span>
      <div class="timing-row__bar-wrap"></div>
      <span class="timing-row__val">${Math.round(total)} ms</span>
    </div></div>`;
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
export function initTabs(containerEl, onChange) {
  if (!containerEl) return;
  const tabs    = containerEl.querySelectorAll('[role="tab"]');
  const panels  = containerEl.querySelectorAll('[role="tabpanel"]');

  function activate(tab) {
    tabs.forEach(t => {
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      t.setAttribute('tabindex', t === tab ? '0' : '-1');
    });
    panels.forEach(p => p.hidden = p.id !== tab.getAttribute('aria-controls'));
    onChange?.(tab.dataset.tab);
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (e) => {
      const idx = [...tabs].indexOf(tab);
      if (e.key === 'ArrowRight') { tabs[(idx + 1) % tabs.length].focus(); activate(tabs[(idx + 1) % tabs.length]); }
      if (e.key === 'ArrowLeft')  { tabs[(idx - 1 + tabs.length) % tabs.length].focus(); activate(tabs[(idx - 1 + tabs.length) % tabs.length]); }
    });
  });

  // activate the one matching URL hash or first
  const hash = window.location.hash.slice(1);
  const target = [...tabs].find(t => t.dataset.tab === hash) ?? tabs[0];
  if (target) activate(target);
}

// ─── Dropdown menu ────────────────────────────────────────────────────────────
export function initDropdowns() {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-dropdown]');
    if (trigger) {
      e.stopPropagation();
      const menu = document.getElementById(trigger.dataset.dropdown);
      const isOpen = menu?.classList.contains('dropdown--open');
      closeAllDropdowns();
      if (!isOpen) {
        menu?.classList.add('dropdown--open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    } else {
      closeAllDropdowns();
    }
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown--open').forEach(m => {
    m.classList.remove('dropdown--open');
    document.querySelector(`[data-dropdown="${m.id}"]`)?.setAttribute('aria-expanded', 'false');
  });
}

// ─── "Last updated" ticker ────────────────────────────────────────────────────
export function startLastUpdatedTicker(elementId) {
  let lastUpdated = new Date();
  const el = document.getElementById(elementId);
  const tick = () => {
    if (el) {
      const diff = Math.floor((Date.now() - lastUpdated) / 1000);
      el.textContent = diff < 5 ? 'just now' : diff < 60 ? `${diff}s ago` : `${Math.floor(diff/60)}m ago`;
    }
  };
  const iv = setInterval(tick, 5000);
  tick();
  return {
    refresh()  { lastUpdated = new Date(); tick(); },
    stop()     { clearInterval(iv); },
  };
}

// ─── Copy button ──────────────────────────────────────────────────────────────
export function initCopyButtons() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch {}
  });
}
