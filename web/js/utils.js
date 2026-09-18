/**
 * PulseWatch — utils.js
 * Shared helpers: sanitization, formatting, time, debounce, etc.
 */

'use strict';

// ─── HTML Sanitization ────────────────────────────────────────────────────────
// Never use innerHTML with untrusted content directly. Use esc() first.
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Number formatting ────────────────────────────────────────────────────────
export function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtUptime(pct) {
  if (pct == null || isNaN(pct)) return '—';
  const n = parseFloat(pct);
  // Show 3 decimal places for uptimes like 99.982%
  if (n >= 99.9) return n.toFixed(3) + '%';
  if (n >= 99)   return n.toFixed(2) + '%';
  return n.toFixed(1) + '%';
}

export function fmtMs(ms) {
  if (ms == null || isNaN(ms)) return '—';
  const n = parseFloat(ms);
  if (n < 1000) return Math.round(n) + ' ms';
  return (n / 1000).toFixed(2) + ' s';
}

export function fmtBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  const b = Number(bytes);
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function fmtPercent(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return parseFloat(n).toFixed(decimals) + '%';
}

// ─── Duration formatting ──────────────────────────────────────────────────────
export function fmtDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const s = Math.round(Number(seconds));
  if (s < 60) return s + 's';
  if (s < 3600) {
    const m = Math.floor(s / 60), rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function fmtUptimeSeconds(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const s = Number(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Time formatting ──────────────────────────────────────────────────────────
export function timeAgo(dateInput) {
  if (!dateInput) return '—';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date)) return '—';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5)   return 'just now';
  if (diff < 60)  return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return fmtDate(date);
}

export function fmtDate(dateInput, opts = {}) {
  if (!dateInput) return '—';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date)) return '—';
  const defaults = { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString(undefined, { ...defaults, ...opts });
}

export function fmtDateTime(dateInput) {
  if (!dateInput) return '—';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date)) return '—';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function fmtTime(dateInput) {
  if (!dateInput) return '—';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date)) return '—';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtISOLocal(dateInput) {
  if (!dateInput) return '';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date)) return '';
  // Returns "YYYY-MM-DDTHH:MM" for datetime-local inputs
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── Status helpers ───────────────────────────────────────────────────────────
export const STATUS_LABELS = {
  up:       'Online',
  down:     'Down',
  degraded: 'Degraded',
  paused:   'Paused',
  pending:  'Pending',
  // server
  online:   'Online',
  offline:  'Offline',
};

export const STATUS_COLORS = {
  up:       'status-up',
  down:     'status-down',
  degraded: 'status-degraded',
  paused:   'status-paused',
  pending:  'status-pending',
  online:   'status-up',
  offline:  'status-down',
};

export function statusBadge(status) {
  const cls = STATUS_COLORS[status] ?? 'status-pending';
  const label = STATUS_LABELS[status] ?? (status ?? 'Unknown');
  return `<span class="badge badge--status ${cls}">${esc(label)}</span>`;
}

export function statusDot(status) {
  const cls = STATUS_COLORS[status] ?? 'status-pending';
  return `<span class="status-dot ${cls}" aria-label="${esc(STATUS_LABELS[status] ?? status)}"></span>`;
}

// ─── Type labels ──────────────────────────────────────────────────────────────
export const TYPE_LABELS = {
  http:  'HTTP',
  api:   'API',
  tcp:   'TCP',
  dns:   'DNS',
  ping:  'PING',
};
export function typeTag(type) {
  return `<span class="tag tag--${esc(type)}">${esc(TYPE_LABELS[type] ?? type?.toUpperCase() ?? '?')}</span>`;
}

// ─── Severity ─────────────────────────────────────────────────────────────────
export const SEVERITY_COLORS = { down: 'badge--danger', degraded: 'badge--warn', info: 'badge--info' };
export function severityBadge(severity) {
  const cls = SEVERITY_COLORS[severity] ?? 'badge--info';
  return `<span class="badge ${cls}">${esc(severity ?? '—')}</span>`;
}

// ─── SSL days remaining ───────────────────────────────────────────────────────
export function sslDaysRemaining(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.floor(diff / 86400000);
}

export function sslBadge(expiresAt) {
  const days = sslDaysRemaining(expiresAt);
  if (days == null) return '<span class="badge badge--muted">No SSL</span>';
  if (days < 0)  return `<span class="badge badge--danger">Expired</span>`;
  if (days < 14) return `<span class="badge badge--danger">${days}d left</span>`;
  if (days < 30) return `<span class="badge badge--warn">${days}d left</span>`;
  return `<span class="badge badge--success">Valid · ${days}d</span>`;
}

// ─── Uptime color class ───────────────────────────────────────────────────────
export function uptimeClass(pct) {
  const n = parseFloat(pct);
  if (isNaN(n)) return '';
  if (n >= 99.9) return 'text-success';
  if (n >= 99)   return 'text-warn';
  return 'text-danger';
}

// ─── Latency color class ──────────────────────────────────────────────────────
export function latencyClass(ms) {
  const n = parseFloat(ms);
  if (isNaN(n)) return '';
  if (n < 300)  return 'text-success';
  if (n < 1000) return 'text-warn';
  return 'text-danger';
}

// ─── Resource usage class ─────────────────────────────────────────────────────
export function resourceClass(pct, warnAt = 75, critAt = 90) {
  const n = parseFloat(pct);
  if (isNaN(n)) return '';
  if (n >= critAt) return 'text-danger';
  if (n >= warnAt) return 'text-warn';
  return 'text-success';
}

// ─── Debounce ─────────────────────────────────────────────────────────────────
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ─── Throttle ─────────────────────────────────────────────────────────────────
export function throttle(fn, limit = 200) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= limit) { last = now; fn(...args); }
  };
}

// ─── Query string helpers ─────────────────────────────────────────────────────
export function getParam(name, fallback = null) {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export function buildQuery(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, v);
  }
  return p.toString() ? '?' + p.toString() : '';
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}
export function $$(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

export function setText(selector, value, parent = document) {
  const node = parent.querySelector(selector);
  if (node) node.textContent = value ?? '—';
}

export function setHTML(selector, value, parent = document) {
  const node = parent.querySelector(selector);
  if (node) node.innerHTML = value ?? '';
}

// ─── Copy to clipboard ────────────────────────────────────────────────────────
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Skeleton line generator ──────────────────────────────────────────────────
export function skeletonLines(count = 3, widths = []) {
  return Array.from({ length: count }, (_, i) => {
    const w = widths[i] ?? (60 + Math.floor(Math.random() * 30)) + '%';
    return `<div class="skeleton skeleton--line" style="width:${w}"></div>`;
  }).join('');
}

export function skeletonTable(rows = 5, cols = 6) {
  const headerCells = Array.from({ length: cols }, () => `<th><div class="skeleton skeleton--line" style="width:70%"></div></th>`).join('');
  const bodyCells   = Array.from({ length: cols }, () => `<td><div class="skeleton skeleton--line"></div></td>`).join('');
  const bodyRows    = Array.from({ length: rows }, () => `<tr>${bodyCells}</tr>`).join('');
  return `<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
}

// ─── Relative-time ticker ─────────────────────────────────────────────────────
// Call start(); it updates any element with [data-time-ago] every 15 s.
const timeAgoRegistry = new Set();
export const RelativeTime = {
  start() {
    setInterval(() => {
      for (const el of document.querySelectorAll('[data-time-ago]')) {
        el.textContent = timeAgo(el.getAttribute('data-time-ago'));
      }
    }, 15_000);
  }
};

// ─── Misc ─────────────────────────────────────────────────────────────────────
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function pluralize(n, singular, plural) {
  return `${fmt(n)} ${n === 1 ? singular : (plural ?? singular + 's')}`;
}

export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
    (acc[k] = acc[k] ?? []).push(item);
    return acc;
  }, {});
}

export function sortBy(arr, key, dir = 'asc') {
  return [...arr].sort((a, b) => {
    const av = typeof key === 'function' ? key(a) : a[key];
    const bv = typeof key === 'function' ? key(b) : b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });
}
