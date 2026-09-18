/**
 * PulseWatch — monitors.js
 * Drives monitors.html: table with search, filter, sort, pagination.
 * Add-monitor modal wired to POST /api/monitors.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Monitors } from './api.js';
import { stream, bindConnectionIndicator } from './websocket.js';
import {
  initSidebar, initGlobalSearch, initDropdowns, initSortHeaders,
  Pagination, Toast, emptyState, errorState,
} from './components.js';
import {
  esc, fmtMs, fmtUptime, timeAgo, statusDot, statusBadge, typeTag,
  debounce, sortBy, getParam, latencyClass, uptimeClass, sparkline,
} from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── State ──────────────────────────────────────────────────────────────────────
let allMonitors   = [];
let filtered      = [];
let sortKey       = 'name';
let sortDir       = 'asc';
let statusFilter  = 'all';
let typeFilter    = '';
let searchQuery   = '';
const PAGE_SIZE   = 50;

const pagination  = new Pagination({
  container: 'monitors-pagination',
  pageSize:  PAGE_SIZE,
  onChange:  (page, offset) => renderTable(filtered.slice(offset, offset + PAGE_SIZE)),
});

// ── Load ───────────────────────────────────────────────────────────────────────
async function load() {
  const tbody = document.getElementById('monitors-tbody');
  try {
    const data = await Monitors.list();
    allMonitors = data.monitors ?? [];
    updateCountSub();
    applyFilters();
  } catch (err) {
    if (tbody) {
      const { html, bindRetry } = errorState(err, load);
      tbody.innerHTML = `<tr><td colspan="10">${html}</td></tr>`;
      bindRetry(tbody);
    }
    Toast.error('Failed to load monitors: ' + err.message);
  }
}

// ── Filter + sort ──────────────────────────────────────────────────────────────
function applyFilters() {
  const q = searchQuery.toLowerCase();
  filtered = allMonitors.filter(m => {
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (typeFilter && m.type !== typeFilter) return false;
    if (q) {
      const cfg = m.config ?? {};
      const target = cfg.url ?? cfg.host ?? cfg.hostname ?? '';
      if (!m.name.toLowerCase().includes(q) && !target.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  filtered = sortBy(filtered, getSortVal, sortDir);
  pagination.total = filtered.length;
  pagination.reset();
  renderTable(filtered.slice(0, PAGE_SIZE));
  updateCountSub();
}

function getSortVal(m) {
  if (sortKey === 'name')          return m.name?.toLowerCase() ?? '';
  if (sortKey === 'type')          return m.type;
  if (sortKey === 'uptime')        return parseFloat(m.uptime?.month ?? 100);
  if (sortKey === 'latency')       return m.last_latency_ms ?? Infinity;
  if (sortKey === 'last_check_at') return m.last_check_at ? new Date(m.last_check_at).getTime() : 0;
  return m[sortKey] ?? '';
}

// ── Render table ───────────────────────────────────────────────────────────────
function renderTable(rows) {
  const tbody = document.getElementById('monitors-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10">${emptyState({ title: 'No monitors match', message: 'Try adjusting your filters.' })}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(m => {
    const cfg    = m.config ?? {};
    const target = cfg.url ?? cfg.host ?? cfg.hostname ?? cfg.address ?? '—';
    const upCls  = uptimeClass(m.uptime?.month ?? 100);
    const latCls = latencyClass(m.last_latency_ms);
    const spark  = sparkline((m.sparkline ?? []).map(p => p.ms).reverse(), { width: 60, height: 18 });
    return `
    <tr onclick="location.href='monitor.html?id=${esc(m.id)}'" class="cursor-pointer">
      <td>${statusDot(m.status)}</td>
      <td class="td-primary">
        <div class="truncate" style="max-width:200px;font-weight:600">${esc(m.name)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:1px">${esc(target)}</div>
      </td>
      <td>${typeTag(m.type)}</td>
      <td class="td-mono" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;font-size:0.75rem;color:var(--text-muted)" title="${esc(target)}">${esc(target)}</td>
      <td class="${upCls}" style="font-family:var(--font-mono);font-size:0.8125rem;font-weight:700">${fmtUptime(m.uptime?.month ?? 100)}</td>
      <td class="td-mono ${latCls}" style="font-size:0.8125rem">${fmtMs(m.last_latency_ms)}</td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)" data-time-ago="${esc(m.last_check_at ?? '')}">${m.last_check_at ? timeAgo(m.last_check_at) : '—'}</td>
      <td class="td-mono" style="font-size:0.75rem">${m.last_status_code ?? '—'}</td>
      <td style="font-size:0.75rem;color:var(--text-muted)">${m.incident_count ?? 0}</td>
      <td class="td-actions">
        <div class="dropdown-wrap">
          <button class="btn btn--ghost btn--icon btn--sm" data-dropdown="mon-menu-${esc(m.id)}" onclick="event.stopPropagation()" aria-label="Actions">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="3" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="13" r="1" fill="currentColor"/></svg>
          </button>
          <div class="dropdown-menu" id="mon-menu-${esc(m.id)}">
            <a href="monitor.html?id=${esc(m.id)}" class="dropdown-item" onclick="event.stopPropagation()">View details</a>
            <button class="dropdown-item" onclick="event.stopPropagation();runCheck('${esc(m.id)}')">Run check now</button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item dropdown-item--danger" onclick="event.stopPropagation();deleteMonitor('${esc(m.id)}','${esc(m.name)}')">Delete</button>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function updateCountSub() {
  const el = document.getElementById('monitor-count-sub');
  if (el) el.textContent = `${filtered.length} of ${allMonitors.length} monitors`;
}

// ── Sort headers ───────────────────────────────────────────────────────────────
const table = document.getElementById('monitors-table');
initSortHeaders(table, (key, dir) => {
  sortKey = key; sortDir = dir; applyFilters();
});

// ── Filter chips ───────────────────────────────────────────────────────────────
document.getElementById('status-chips')?.addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('#status-chips .filter-chip').forEach(c => c.classList.remove('filter-chip--active'));
  chip.classList.add('filter-chip--active');
  statusFilter = chip.dataset.filter;
  applyFilters();
});

document.getElementById('type-chips')?.addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  const isActive = chip.classList.contains('filter-chip--active');
  document.querySelectorAll('#type-chips .filter-chip').forEach(c => c.classList.remove('filter-chip--active'));
  if (!isActive) { chip.classList.add('filter-chip--active'); typeFilter = chip.dataset.type; }
  else typeFilter = '';
  applyFilters();
});

// ── Search ─────────────────────────────────────────────────────────────────────
const searchInput = document.getElementById('monitor-search');
searchInput?.addEventListener('input', debounce(e => {
  searchQuery = e.target.value.trim();
  applyFilters();
}, 250));

// Pre-fill from URL param
const qParam = getParam('q');
if (qParam && searchInput) { searchInput.value = qParam; searchQuery = qParam; }

// ── Add monitor modal ─────────────────────────────────────────────────────────
const modal = document.getElementById('add-monitor-modal');
function openModal()  { modal?.classList.add('modal-backdrop--open');  document.body.classList.add('modal-open');  }
function closeModal() { modal?.classList.remove('modal-backdrop--open'); document.body.classList.remove('modal-open'); }

document.getElementById('add-monitor-btn')?.addEventListener('click', openModal);
if (getParam('new') === '1') openModal();

modal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', closeModal));
modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.getElementById('save-monitor-btn')?.addEventListener('click', async () => {
  const errEl = document.getElementById('mon-form-error');
  errEl.style.display = 'none';

  const name      = document.getElementById('mon-name').value.trim();
  const type      = document.getElementById('mon-type').value;
  const interval  = parseInt(document.getElementById('mon-interval').value, 10);
  const timeout   = parseInt(document.getElementById('mon-timeout').value, 10);
  const failT     = parseInt(document.getElementById('mon-fail-thresh').value, 10);
  const degraded  = document.getElementById('mon-degraded-ms').value;
  const url       = document.getElementById('mon-url').value.trim();

  if (!name || !url) { errEl.textContent = 'Name and URL are required.'; errEl.style.display = 'block'; return; }

  // Build config based on type
  const config = {};
  if (['http','api'].includes(type))  config.url  = url;
  if (type === 'tcp')  { const [h, p] = url.split(':'); config.host = h; config.port = parseInt(p, 10); }
  if (type === 'dns')  config.hostname = url;
  if (type === 'ping') config.host     = url;

  const btn = document.getElementById('save-monitor-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await Monitors.create({
      name, type,
      intervalSeconds:   interval,
      timeoutMs:         timeout,
      failureThreshold:  failT,
      recoveryThreshold: 2,
      degradedLatencyMs: degraded ? parseInt(degraded, 10) : null,
      config,
    });
    Toast.success(`Monitor "${name}" created`);
    closeModal();
    await load();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Create Monitor';
  }
});

// ── Run check ─────────────────────────────────────────────────────────────────
window.runCheck = async (id) => {
  try {
    await Monitors.run(id);
    Toast.success('Check queued');
    setTimeout(load, 3_000);
  } catch (err) { Toast.error(err.message); }
};

// ── Delete monitor ─────────────────────────────────────────────────────────────
window.deleteMonitor = async (id, name) => {
  const { confirm } = await import('./components.js');
  const ok = await confirm(`Delete monitor "${name}"? This cannot be undone.`, { danger: true, confirmText: 'Delete' });
  if (!ok) return;
  try {
    await Monitors.delete(id);
    Toast.success(`Monitor "${name}" deleted`);
    await load();
  } catch (err) { Toast.error(err.message); }
};

// ── SSE real-time status updates ───────────────────────────────────────────────
stream.start();
bindConnectionIndicator('connection-indicator');
stream.on('monitor.status', (evt) => {
  const m = allMonitors.find(m => m.id === evt.data?.monitorId);
  if (m) { m.status = evt.data.status; applyFilters(); }
});

// ── Refresh button ─────────────────────────────────────────────────────────────
document.getElementById('refresh-btn')?.addEventListener('click', async () => {
  await load();
  Toast.success('Monitors refreshed');
});

// ── Relative time ticker ───────────────────────────────────────────────────────
setInterval(() => {
  document.querySelectorAll('[data-time-ago]').forEach(el => {
    const t = el.getAttribute('data-time-ago');
    if (t) el.textContent = timeAgo(t);
  });
}, 15_000);

await load();
