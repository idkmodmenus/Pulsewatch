/**
 * PulseWatch — dashboard.js
 * Drives index.html: KPI cards, monitor status list, latency/failures chart,
 * recent incidents, slowest monitors, server health mini-cards.
 * Real-time updates via SSE (stream).
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Dashboard, Incidents } from './api.js';
import { stream, bindConnectionIndicator, STATE } from './websocket.js';
import {
  initSidebar, initGlobalSearch, initDropdowns, initCopyButtons,
  Toast, showOfflineBanner, hideOfflineBanner, startLastUpdatedTicker,
  emptyState, errorState,
} from './components.js';
import { createDashboardChart } from './charts.js';
import {
  esc, fmtMs, fmtUptime, fmtDuration, fmtDateTime, timeAgo,
  statusDot, statusBadge, typeTag, latencyClass, uptimeClass,
  skeletonLines,
} from './utils.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────────
const { principal, org } = await requireAuth() ?? {};
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
initCopyButtons();

document.getElementById('logout-btn')?.addEventListener('click', () => logout());
document.getElementById('topbar-user-name').textContent = principal?.name ?? principal?.email ?? '—';

// ── State ─────────────────────────────────────────────────────────────────────
let dashData   = null;
let dashChart  = null;
const ticker   = startLastUpdatedTicker('last-updated-text');

// ── Load dashboard ─────────────────────────────────────────────────────────────
async function load(showSkeletons = false) {
  try {
    dashData = await Dashboard.get();
    hideOfflineBanner();
    ticker.refresh();
    render(dashData);
  } catch (err) {
    showOfflineBanner(ticker._lastUpdated);
    if (showSkeletons) renderError(err);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render(d) {
  renderKPI(d);
  renderSystemStatus(d.summary);
  renderMonitorTable(d);
  renderIncidents(d.incidents);
  renderSlowest(d.slowest);
  renderAgents(d.agents);
  renderChart(d.series);
}

function renderKPI(d) {
  const s = d.summary ?? {};
  const lat = d.latency ?? {};
  const up  = d.uptime  ?? {};

  const total = s.total ?? 0;
  set('kpi-total',       total);
  set('kpi-total-sub',   `${s.pending ?? 0} pending`);

  set('kpi-up',          s.up ?? 0);
  set('kpi-up-sub',      pct(s.up, total) + ' of total');

  set('kpi-down',        s.down ?? 0);
  set('kpi-down-sub',    s.down ? 'Needs attention' : 'All clear');

  set('kpi-degraded',    s.degraded ?? 0);
  set('kpi-degraded-sub',s.paused ? `${s.paused} paused` : '');

  set('kpi-uptime',      fmtUptime(up.uptime));
  set('kpi-uptime-sub',  `${fmt(up.checks)} checks · ${fmt(up.failures)} failures`);

  set('kpi-latency',     fmtMs(lat.avg_ms));
  set('kpi-latency-sub', lat.samples ? `P95 ${fmtMs(lat.p95_ms)} · P99 ${fmtMs(lat.p99_ms)}` : 'No data');

  const openInc = (d.incidents ?? []).filter(i => i.status === 'open').length;
  set('kpi-incidents',   openInc);
  set('kpi-incidents-sub', openInc ? 'Active incidents' : 'No active incidents');

  set('kpi-servers',     d.agents?.length ?? 0);
  const onlineSrv = (d.agents ?? []).filter(a => a.status === 'online').length;
  set('kpi-servers-sub', `${onlineSrv} online`);
}

function renderSystemStatus(s) {
  const pill = document.getElementById('system-status-pill');
  const txt  = document.getElementById('system-status-text');
  if (!pill || !txt) return;
  if ((s?.down ?? 0) > 0) {
    pill.className = 'topbar__status topbar__status--incident';
    txt.textContent = `${s.down} monitor${s.down > 1 ? 's' : ''} down`;
  } else if ((s?.degraded ?? 0) > 0) {
    pill.className = 'topbar__status topbar__status--degraded';
    txt.textContent = `${s.degraded} monitor${s.degraded > 1 ? 's' : ''} degraded`;
  } else {
    pill.className = 'topbar__status topbar__status--operational';
    txt.textContent = 'All systems operational';
  }

  // Sidebar incident badge
  const badge = document.getElementById('sidebar-incident-count');
  const open = (dashData?.incidents ?? []).filter(i => i.status === 'open').length;
  if (badge) {
    badge.textContent = open;
    badge.style.display = open > 0 ? '' : 'none';
  }
}

function renderMonitorTable(d) {
  const tbody = document.getElementById('monitor-table-body');
  if (!tbody) return;
  const monitors = d.monitors ?? [];
  if (!monitors.length) {
    tbody.innerHTML = `<tr><td colspan="6">${emptyState({ title: 'No monitors yet', message: 'Add your first monitor to start tracking uptime.', action: '<a href="monitors.html?new=1" class="btn btn--primary btn--sm">Add Monitor</a>' })}</td></tr>`;
    return;
  }
  tbody.innerHTML = monitors.map(m => {
    const upClass = uptimeClass(m.uptime?.month ?? 100);
    return `
    <tr class="cursor-pointer" onclick="location.href='monitor.html?id=${esc(m.id)}'">
      <td>${statusDot(m.status)}</td>
      <td class="td-primary">
        <div class="truncate" style="max-width:220px" title="${esc(m.name)}">${esc(m.name)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted)">${typeTag(m.type)}</div>
      </td>
      <td class="${upClass}" style="font-family:var(--font-mono);font-size:0.8125rem;font-weight:600">
        ${fmtUptime(m.uptime?.month ?? 100)}
      </td>
      <td class="td-mono ${latencyClass(m.last_latency_ms)}">${fmtMs(m.last_latency_ms)}</td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)" data-time-ago="${esc(m.last_check_at ?? '')}">
        ${m.last_check_at ? timeAgo(m.last_check_at) : '—'}
      </td>
      <td class="td-mono" style="font-size:0.75rem">${m.last_status_code ? esc(String(m.last_status_code)) : '—'}</td>
    </tr>`;
  }).join('');
}

function renderIncidents(incidents) {
  const el = document.getElementById('incidents-list');
  if (!el) return;
  if (!incidents?.length) {
    el.innerHTML = emptyState({ title: 'No recent incidents', message: 'Everything is running smoothly.' });
    return;
  }
  el.innerHTML = incidents.map(i => {
    const dotColor = i.status === 'open' ? 'var(--color-danger)' : i.status === 'acknowledged' ? 'var(--color-warn)' : 'var(--color-muted)';
    const dur = i.duration_seconds ? fmtDuration(i.duration_seconds) : i.status === 'open' ? 'Ongoing' : '—';
    return `
    <div class="incident-item" onclick="location.href='incidents.html'" style="cursor:pointer">
      <span class="status-dot" style="background:${dotColor};margin-top:4px;flex-shrink:0"></span>
      <div style="min-width:0;flex:1">
        <div class="incident-title truncate">${esc(i.monitor_name)} — ${esc(i.cause ?? i.severity ?? 'Incident')}</div>
        <div class="incident-meta">
          <span>${esc(i.monitor_type?.toUpperCase() ?? '')}</span>
          <span>${timeAgo(i.started_at)}</span>
          ${i.duration_seconds || i.status === 'open' ? `<span>${dur}</span>` : ''}
        </div>
      </div>
      <div>${statusBadge(i.status)}</div>
    </div>`;
  }).join('');
}

function renderSlowest(slowest) {
  const el = document.getElementById('slowest-list');
  if (!el) return;
  if (!slowest?.length) {
    el.innerHTML = `<div style="padding:1rem;font-size:0.8125rem;color:var(--text-muted)">No latency data in the last hour.</div>`;
    return;
  }
  el.innerHTML = slowest.map((m, i) => `
    <div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 1rem;border-bottom:1px solid var(--border)" onclick="location.href='monitor.html?id=${esc(m.id)}'" class="cursor-pointer">
      <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);width:16px;flex-shrink:0">${i + 1}</span>
      ${statusDot(m.status)}
      <div style="flex:1;min-width:0">
        <div class="truncate" style="font-size:0.8125rem;font-weight:500;color:var(--text-primary)">${esc(m.name)}</div>
        <div style="font-size:0.7rem">${typeTag(m.type)}</div>
      </div>
      <div style="font-family:var(--font-mono);font-size:0.8125rem;font-weight:700;color:var(--color-warn)">${fmtMs(m.avg_ms)}</div>
    </div>`).join('');
}

function renderAgents(agents) {
  const el = document.getElementById('agents-mini');
  if (!el) return;
  if (!agents?.length) {
    el.innerHTML = `<div style="padding:1rem;font-size:0.8125rem;color:var(--text-muted)">No servers configured. <a href="servers.html">Add one →</a></div>`;
    return;
  }
  el.innerHTML = agents.map(a => {
    const cpu  = a.cpu  != null ? Math.round(a.cpu)  : null;
    const mem  = a.memory != null ? Math.round(a.memory) : null;
    const cpuCls = cpu == null ? '' : cpu >= 90 ? 'text-danger' : cpu >= 75 ? 'text-warn' : 'text-success';
    const memCls = mem == null ? '' : mem >= 90 ? 'text-danger' : mem >= 75 ? 'text-warn' : 'text-success';
    return `
    <div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 1rem;border-bottom:1px solid var(--border)" onclick="location.href='server.html?id=${esc(a.id)}'" class="cursor-pointer">
      ${statusDot(a.status)}
      <div style="flex:1;min-width:0">
        <div class="truncate" style="font-size:0.8125rem;font-weight:500;color:var(--text-primary)">${esc(a.name)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted)">${esc(a.hostname ?? '—')}</div>
      </div>
      <div style="display:flex;gap:0.75rem;font-size:0.75rem;font-family:var(--font-mono)">
        ${cpu != null ? `<span class="${cpuCls}" title="CPU">CPU ${cpu}%</span>` : ''}
        ${mem != null ? `<span class="${memCls}" title="RAM">RAM ${mem}%</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderChart(series) {
  const wrap = document.getElementById('dash-chart-wrap');
  if (wrap) wrap.classList.remove('chart-container--loading');
  if (!series?.length) return;
  if (dashChart) {
    dashChart.update(series);
  } else {
    dashChart = createDashboardChart('dash-chart', series);
  }
}

function renderError(err) {
  const { html, bindRetry } = errorState(err, () => load(false));
  const el = document.getElementById('monitor-table-body');
  if (el) { el.innerHTML = `<tr><td colspan="6">${html}</td></tr>`; bindRetry(el); }
}

// ── Real-time updates via SSE ──────────────────────────────────────────────────
stream.start();
bindConnectionIndicator('connection-indicator');

// Also update the LIVE badge in the chart card
stream.onStateChange(state => {
  const badge = document.getElementById('live-badge');
  if (!badge) return;
  if (state === STATE.LIVE) {
    badge.className = 'connection-indicator indicator--live';
    badge.querySelector('.indicator__text').textContent = 'Live';
  } else {
    badge.className = `connection-indicator indicator--${state}`;
    badge.querySelector('.indicator__text').textContent = state === STATE.CONNECTING ? 'Connecting' : 'Offline';
  }
});

// On any event, refresh dashboard data (debounced — max once per 5s)
let refreshTimer = null;
stream.on('*', () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load(false), 5_000);
});

// Immediate update for monitor status change
stream.on('monitor.status', (evt) => {
  updateMonitorRowStatus(evt.data?.monitorId, evt.data?.status);
});

// Immediate update for agent telemetry
stream.on('agent.telemetry', (evt) => {
  updateAgentMini(evt.data);
});

stream.on('incident.opened', () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load(false), 2_000);
});

// ── Patch a single monitor row without re-rendering the whole table ────────────
function updateMonitorRowStatus(monitorId, newStatus) {
  if (!monitorId || !newStatus) return;
  if (!dashData) return;
  const m = (dashData.monitors ?? []).find(m => m.id === monitorId);
  if (m) {
    m.status = newStatus;
    const rows = document.querySelectorAll('#monitor-table-body tr');
    for (const row of rows) {
      if (row.getAttribute('onclick')?.includes(monitorId)) {
        const dot = row.querySelector('.status-dot');
        if (dot) {
          dot.className = 'status-dot status-' + newStatus;
        }
      }
    }
    renderSystemStatus(dashData.summary);
  }
}

// ── Refresh button ─────────────────────────────────────────────────────────────
document.getElementById('refresh-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn?.classList.add('spinning');
  await load(false);
  btn?.classList.remove('spinning');
  Toast.success('Dashboard refreshed');
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function set(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

function pct(part, total) {
  if (!total) return '—';
  return ((part / total) * 100).toFixed(1) + '%';
}

function updateAgentMini(data) {
  if (!data?.agentId || !dashData?.agents) return;
  const agent = dashData.agents.find(a => a.id === data.agentId);
  if (agent) {
    agent.cpu    = data.cpu;
    agent.memory = data.memory;
    agent.disk   = data.disk;
    renderAgents(dashData.agents);
  }
}

// ── Initial load ───────────────────────────────────────────────────────────────
await load(true);

// ── Relative time ticker (updates data-time-ago elements every 15s) ───────────
setInterval(() => {
  document.querySelectorAll('[data-time-ago]').forEach(el => {
    const t = el.getAttribute('data-time-ago');
    if (t) el.textContent = timeAgo(t);
  });
}, 15_000);
