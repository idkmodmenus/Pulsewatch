/**
 * PulseWatch — servers.js
 * Drives servers.html: server card grid, add-server modal.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Servers } from './api.js';
import { stream, bindConnectionIndicator } from './websocket.js';
import {
  initSidebar, initGlobalSearch, initDropdowns, initCopyButtons,
  Toast, emptyState, errorState, gaugeBar, confirm,
} from './components.js';
import {
  esc, fmtPercent, fmtUptimeSeconds, timeAgo,
  statusDot, statusBadge, resourceClass,
} from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
initCopyButtons();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── Load ───────────────────────────────────────────────────────────────────────
let agents = [];

async function load() {
  try {
    const data = await Servers.list();
    agents = data.agents ?? [];
    renderKPI(agents);
    renderGrid(agents);
    updateCountSub(agents);
  } catch (err) {
    const { html, bindRetry } = errorState(err, load);
    const grid = document.getElementById('servers-grid');
    if (grid) { grid.innerHTML = html; bindRetry(grid); }
    Toast.error('Failed to load servers: ' + err.message);
  }
}

// ── KPI ────────────────────────────────────────────────────────────────────────
function renderKPI(a) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v ?? '—'; };
  set('srv-kpi-total',  a.length);
  set('srv-kpi-online', a.filter(s => s.status === 'online').length);
  set('srv-kpi-offline',a.filter(s => s.status === 'offline').length);
  const withCpu = a.filter(s => s.cpu != null);
  set('srv-kpi-cpu', withCpu.length
    ? Math.round(withCpu.reduce((s, a) => s + parseFloat(a.cpu), 0) / withCpu.length) + '%'
    : '—');
}

// ── Grid ───────────────────────────────────────────────────────────────────────
function renderGrid(a) {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;
  if (!a.length) {
    grid.innerHTML = emptyState({
      title: 'No servers yet',
      message: 'Install the PulseWatch agent on your server to start collecting metrics.',
      action: '<button class="btn btn--primary btn--sm" id="add-server-btn-empty">Add Server</button>',
    });
    document.getElementById('add-server-btn-empty')?.addEventListener('click', openModal);
    return;
  }
  grid.innerHTML = a.map(s => serverCard(s)).join('');
  // Bind click events
  grid.querySelectorAll('[data-server-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      location.href = 'server.html?id=' + card.dataset.serverId;
    });
  });
  grid.querySelectorAll('[data-delete-server]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteServer(btn.dataset.deleteServer, btn.dataset.serverName);
    });
  });
}

function serverCard(s) {
  const cpu  = s.cpu  != null ? parseFloat(s.cpu)  : null;
  const mem  = s.memory != null ? parseFloat(s.memory) : null;
  const disk = s.disk != null ? parseFloat(s.disk) : null;
  const load = s.load1 != null ? parseFloat(s.load1).toFixed(2) : null;
  const thr  = s.thresholds ?? { cpu: 90, memory: 90, disk: 90 };

  return `
  <div class="server-card" data-server-id="${esc(s.id)}" style="cursor:pointer">
    <div class="server-card__header">
      <div style="min-width:0">
        <div class="server-card__name">${esc(s.name)}</div>
        <div class="server-card__host">${esc(s.hostname ?? '—')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        ${statusDot(s.status)}
        <button class="btn btn--ghost btn--icon btn--sm" data-delete-server="${esc(s.id)}" data-server-name="${esc(s.name)}" title="Remove server" aria-label="Remove server">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="2 4 14 4"/><path d="M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9"/></svg>
        </button>
      </div>
    </div>
    <div class="server-card__metrics">
      ${metricGauge('CPU', cpu, thr.cpu)}
      ${metricGauge('Memory', mem, thr.memory)}
      ${metricGauge('Disk', disk, thr.disk)}
      <div>
        <div class="server-card__metric-label">Load (1m)</div>
        <div style="font-size:0.9rem;font-weight:700;font-family:var(--font-mono);color:var(--text-primary)">${load ?? '—'}</div>
      </div>
    </div>
    <div class="server-card__footer">
      <span>${s.uptime_seconds ? 'Up ' + fmtUptimeSeconds(s.uptime_seconds) : '—'}</span>
      <span>Heartbeat ${s.last_seen_at ? timeAgo(s.last_seen_at) : 'never'}</span>
    </div>
    ${s.ipv4?.length ? `<div style="font-size:0.7rem;color:var(--text-muted);padding-top:0.5rem;border-top:1px solid var(--border)">${s.ipv4.slice(0, 2).map(ip => esc(ip)).join(', ')}</div>` : ''}
  </div>`;
}

function metricGauge(label, pct, threshold = 90) {
  const warn = threshold - 15;
  const val  = pct != null ? Math.round(pct) : null;
  const cls  = val == null ? '' : val >= threshold ? 'text-danger' : val >= warn ? 'text-warn' : 'text-success';
  return `
  <div>
    <div class="server-card__metric-label">${esc(label)}</div>
    ${val != null ? gaugeBar(val, warn, threshold) : '<span style="color:var(--text-muted);font-size:0.8125rem">—</span>'}
  </div>`;
}

function updateCountSub(a) {
  const el = document.getElementById('server-count-sub');
  if (el) el.textContent = `${a.filter(s => s.status === 'online').length} online · ${a.length} total`;
}

// ── Add server modal ───────────────────────────────────────────────────────────
const modal = document.getElementById('add-server-modal');
function openModal()  { modal?.classList.add('modal-backdrop--open');  document.body.classList.add('modal-open');  }
function closeModal() { modal?.classList.remove('modal-backdrop--open'); document.body.classList.remove('modal-open'); clearNewToken(); }

document.getElementById('add-server-btn')?.addEventListener('click', openModal);
modal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', closeModal));
modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function clearNewToken() {
  const result = document.getElementById('srv-token-result');
  if (result) result.style.display = 'none';
  document.getElementById('srv-form-error').style.display = 'none';
  document.getElementById('save-server-btn').style.display = '';
}

document.getElementById('save-server-btn')?.addEventListener('click', async () => {
  const errEl = document.getElementById('srv-form-error');
  errEl.style.display = 'none';
  const name      = document.getElementById('srv-name').value.trim();
  const heartbeat = parseInt(document.getElementById('srv-heartbeat').value, 10) || 120;
  if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('save-server-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const data = await Servers.create({ name, heartbeatTimeoutSeconds: heartbeat });
    // Show the token (shown once only)
    const result = document.getElementById('srv-token-result');
    const tokenEl = document.getElementById('srv-token-value');
    const copyBtn = result.querySelector('[data-copy]');
    if (tokenEl) tokenEl.textContent = data.token;
    if (copyBtn) copyBtn.setAttribute('data-copy', data.token);
    result.style.display = 'block';
    btn.style.display = 'none';
    Toast.success(`Server "${name}" created`);
    await load();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Create Agent';
  }
});

// ── Delete server ─────────────────────────────────────────────────────────────
async function deleteServer(id, name) {
  const ok = await confirm(`Remove server "${name}"? Metrics history will be deleted.`, { danger: true, confirmText: 'Remove' });
  if (!ok) return;
  try {
    await Servers.delete(id);
    Toast.success(`Server "${name}" removed`);
    await load();
  } catch (err) { Toast.error(err.message); }
}

// ── SSE real-time telemetry ────────────────────────────────────────────────────
stream.start();
bindConnectionIndicator('connection-indicator');
stream.on('agent.telemetry', (evt) => {
  const a = agents.find(s => s.id === evt.data?.agentId);
  if (a) {
    a.cpu    = evt.data.cpu;
    a.memory = evt.data.memory;
    a.disk   = evt.data.disk;
    a.status = 'online';
    renderKPI(agents);
    renderGrid(agents);
  }
});
stream.on('agent.offline', (evt) => {
  const a = agents.find(s => s.id === evt.data?.agentId);
  if (a) { a.status = 'offline'; renderGrid(agents); renderKPI(agents); }
});

// ── Refresh ────────────────────────────────────────────────────────────────────
document.getElementById('refresh-btn')?.addEventListener('click', () => { load(); Toast.success('Refreshed'); });

await load();
