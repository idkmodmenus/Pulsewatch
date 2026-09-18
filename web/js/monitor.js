/**
 * PulseWatch — monitor.js
 * Drives monitor.html: detail page with latency chart, check history,
 * incidents, DNS/IP, SSL info, config tab.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Monitors } from './api.js';
import { stream, bindConnectionIndicator } from './websocket.js';
import {
  initSidebar, initGlobalSearch, initDropdowns, initTabs, Toast,
  emptyState, errorState, timingBreakdown,
} from './components.js';
import { createLatencyChart } from './charts.js';
import {
  esc, fmtMs, fmtUptime, fmtDateTime, fmtDate, timeAgo,
  statusDot, statusBadge, typeTag, sslBadge, sslDaysRemaining,
  latencyClass, uptimeClass, getParam,
} from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── Get monitor ID from URL ────────────────────────────────────────────────────
const monitorId = getParam('id');
if (!monitorId) { location.href = 'monitors.html'; throw new Error('No id'); }

// ── State ──────────────────────────────────────────────────────────────────────
let monitor    = null;
let latChart   = null;
let checksData = [];
let checksBefore = null;
let onlyFailures = false;
let currentWindow = '24h';

// ── Initial load ───────────────────────────────────────────────────────────────
await loadMonitor();
await loadLatency('24h');

// Tab initialisation
initTabs(document.getElementById('monitor-tabs').closest('.tabs')?.parentElement, async (tab) => {
  if (tab === 'checks')    await loadChecks(true);
  if (tab === 'incidents') await loadIncidents();
  if (tab === 'dns')       renderDNS();
  if (tab === 'ssl')       renderSSL();
  if (tab === 'config')    renderConfig();
});

// Actually wire tabs properly on the tablist element
const tabList = document.querySelector('[role="tablist"]');
if (tabList) {
  initTabs(tabList, async (tab) => {
    if (tab === 'checks')    await loadChecks(true);
    if (tab === 'incidents') await loadIncidents();
    if (tab === 'dns')       renderDNS();
    if (tab === 'ssl')       renderSSL();
    if (tab === 'config')    renderConfig();
  });
}

// ── Load monitor detail ────────────────────────────────────────────────────────
async function loadMonitor() {
  try {
    const data = await Monitors.get(monitorId);
    monitor = data;
    renderHeader(data);
    renderStats(data);
    renderRecentChecks(data.checks ?? []);
    renderTimingBreakdown(data.checks?.[0]?.timings ?? null);
    document.getElementById('breadcrumb-name').textContent = data.monitor?.name ?? '—';
    document.title = `PulseWatch — ${data.monitor?.name ?? 'Monitor'}`;
  } catch (err) {
    Toast.error('Failed to load monitor: ' + err.message);
  }
}

// ── Render header ──────────────────────────────────────────────────────────────
function renderHeader(d) {
  const m = d.monitor;
  const cfg = m.config ?? {};
  const target = cfg.url ?? cfg.host ?? cfg.hostname ?? cfg.address ?? '—';

  document.getElementById('monitor-title').textContent = m.name;
  document.getElementById('monitor-url').textContent   = target;
  document.getElementById('breadcrumb-name').textContent = m.name;

  const dotEl = document.getElementById('monitor-status-dot');
  if (dotEl) dotEl.innerHTML = statusDot(m.status);

  document.getElementById('monitor-type-tag').innerHTML   = typeTag(m.type);
  document.getElementById('monitor-status-badge').innerHTML = statusBadge(m.status);
}

// ── Render stats row ───────────────────────────────────────────────────────────
function renderStats(d) {
  const up  = d.uptime  ?? {};
  const lat = d.latency ?? {};
  const m   = d.monitor;

  const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val ?? '—'; };
  const cls   = (id, val) => { const e = document.getElementById(id); if (e) e.className = 'kpi-card__value ' + (uptimeClass(val) || 'kpi-card__value--accent'); };

  setEl('stat-uptime-day',   fmtUptime(up.day));
  setEl('stat-uptime-week',  fmtUptime(up.week));
  setEl('stat-uptime-month', fmtUptime(up.month));
  setEl('stat-latency',      fmtMs(m?.last_latency_ms));
  cls('stat-uptime-day',   up.day);
  cls('stat-uptime-week',  up.week);
  cls('stat-uptime-month', up.month);

  setEl('p-current', fmtMs(m?.last_latency_ms));
  setEl('p-avg',     fmtMs(lat.avg_ms));
  setEl('p-p50',     fmtMs(lat.p50_ms));
  setEl('p-p95',     fmtMs(lat.p95_ms));
  setEl('p-p99',     fmtMs(lat.p99_ms));
}

// ── Render recent checks (overview tab) ────────────────────────────────────────
function renderRecentChecks(checks) {
  const tbody = document.getElementById('recent-checks-tbody');
  if (!tbody) return;
  if (!checks.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:1rem;text-align:center;color:var(--text-muted)">No checks yet</td></tr>`;
    return;
  }
  tbody.innerHTML = checks.slice(0, 8).map(c => `
    <tr>
      <td class="td-mono" style="font-size:0.75rem">${fmtDateTime(c.created_at)}</td>
      <td>${c.ok ? '<span class="check-ok">OK</span>' : '<span class="check-fail">FAIL</span>'}</td>
      <td class="td-mono ${latencyClass(c.latency_ms)}">${fmtMs(c.latency_ms)}</td>
      <td class="td-mono" style="font-size:0.75rem">${c.status_code ?? '—'}</td>
      <td class="td-mono" style="font-size:0.7rem;color:var(--text-muted)">${esc(c.resolved_ip ?? '—')}</td>
    </tr>`).join('');
}

// ── Render timing breakdown (overview tab) ────────────────────────────────────
function renderTimingBreakdown(timings) {
  const el = document.getElementById('timing-breakdown-wrap');
  if (el) el.innerHTML = timingBreakdown(timings);
}

// ── Latency chart ──────────────────────────────────────────────────────────────
async function loadLatency(window) {
  currentWindow = window;
  try {
    const data = await Monitors.latency(monitorId, window);
    const series = data.series ?? [];
    if (latChart) {
      latChart.update(series);
    } else {
      latChart = createLatencyChart('latency-chart', series);
    }
    // Update percentile stats from the aggregated series
    if (series.length) {
      const last = series[series.length - 1];
      const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val ?? '—'; };
      setEl('p-avg', fmtMs(series.reduce((s, d) => s + (d.avg_ms ?? 0), 0) / series.length));
      setEl('p-p95', fmtMs(last.p95_ms));
      setEl('p-p99', fmtMs(last.p99_ms));
    }
  } catch (err) {
    Toast.error('Failed to load latency data');
  }
}

// Range buttons
document.querySelectorAll('.range-btn[data-window]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn[data-window]').forEach(b => b.classList.remove('range-btn--active'));
    btn.classList.add('range-btn--active');
    loadLatency(btn.dataset.window);
  });
});

// ── Check history tab ──────────────────────────────────────────────────────────
async function loadChecks(reset = false) {
  if (reset) { checksData = []; checksBefore = null; }
  const tbody = document.getElementById('checks-tbody');
  if (!tbody) return;
  try {
    const data = await Monitors.checks(monitorId, {
      limit: 100,
      before: checksBefore,
      onlyFailures,
    });
    const checks = data.checks ?? [];
    checksData = reset ? checks : [...checksData, ...checks];
    checksBefore = checks.length ? checks[checks.length - 1].created_at : null;
    renderChecksTable(checksData);
    document.getElementById('load-more-checks').style.display = checks.length < 100 ? 'none' : '';
  } catch (err) {
    Toast.error('Failed to load checks: ' + err.message);
  }
}

function renderChecksTable(checks) {
  const tbody = document.getElementById('checks-tbody');
  if (!tbody) return;
  if (!checks.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="padding:1.5rem;text-align:center;color:var(--text-muted)">No checks found.</td></tr>`;
    return;
  }
  tbody.innerHTML = checks.map(c => {
    const t = c.timings ?? {};
    return `
    <tr>
      <td class="td-mono" style="font-size:0.75rem">${fmtDateTime(c.created_at)}</td>
      <td>${c.ok ? '<span class="check-ok">OK</span>' : '<span class="check-fail">FAIL</span>'}</td>
      <td class="td-mono ${latencyClass(c.latency_ms)}">${fmtMs(c.latency_ms)}</td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)">${fmtMs(t.dns)}</td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)">${fmtMs(t.tcp)}</td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)">${fmtMs(t.tls)}</td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)">${fmtMs(t.ttfb)}</td>
      <td class="td-mono" style="font-size:0.75rem">${c.status_code ?? '—'}</td>
      <td class="td-mono" style="font-size:0.7rem;color:var(--text-muted)">${esc(c.resolved_ip ?? '—')}</td>
      <td style="font-size:0.75rem;color:var(--color-danger);max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.error ?? '')}">${esc(c.error ?? '')}</td>
    </tr>`;
  }).join('');
}

document.getElementById('load-more-checks')?.addEventListener('click', () => loadChecks(false));
document.getElementById('failures-only')?.addEventListener('change', e => {
  onlyFailures = e.target.checked;
  loadChecks(true);
});

// ── Incidents tab ─────────────────────────────────────────────────────────────
async function loadIncidents() {
  const el = document.getElementById('monitor-incidents-list');
  if (!el) return;
  try {
    const data = await Monitors.incidents(monitorId);
    const incidents = data.incidents ?? [];
    if (!incidents.length) {
      el.innerHTML = emptyState({ title: 'No incidents', message: 'This monitor has no recorded incidents.' });
      return;
    }
    el.innerHTML = incidents.map(i => renderIncidentItem(i)).join('');
  } catch (err) {
    Toast.error('Failed to load incidents');
  }
}

function renderIncidentItem(i) {
  const events = i.events ?? [];
  const timeline = events.map(e => {
    const dotCls = e.kind === 'recovered' || e.kind === 'resolved' ? 'timeline-dot--success'
      : e.kind === 'opened' ? 'timeline-dot--danger' : 'timeline-dot--info';
    return `
    <div class="timeline-item">
      <div class="timeline-dot ${dotCls}"></div>
      <div class="timeline-content">
        <div class="timeline-event">${esc(e.message ?? e.kind)}</div>
        <div class="timeline-time">${fmtDateTime(e.at)}</div>
      </div>
    </div>`;
  }).join('');
  return `
  <div style="padding:1rem;border-bottom:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem">
      <div>
        <div style="font-weight:600;color:var(--text-primary);font-size:0.875rem">${esc(i.cause ?? i.severity ?? 'Incident')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">
          Started ${fmtDateTime(i.started_at)} ${i.duration_seconds ? '· Duration: ' + fmtDuration(i.duration_seconds) : ''}
        </div>
      </div>
      ${statusBadge(i.status)}
    </div>
    ${timeline ? `<div class="timeline" style="margin-top:0.75rem">${timeline}</div>` : ''}
  </div>`;
}

function fmtDuration(s) {
  const m = Math.floor(s / 60), rem = s % 60;
  return m ? `${m}m ${rem}s` : `${rem}s`;
}

// ── DNS tab ────────────────────────────────────────────────────────────────────
function renderDNS() {
  const tbody = document.getElementById('dns-tbody');
  if (!tbody || !monitor) return;
  const addrs = monitor.addresses ?? [];
  if (!addrs.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:1rem;text-align:center;color:var(--text-muted)">No IP history</td></tr>`;
    document.getElementById('ip-change-info').textContent = 'No IP changes detected.';
    return;
  }
  tbody.innerHTML = addrs.map(a => `
    <tr>
      <td class="td-mono" style="font-size:0.8125rem">${esc(a.ip)}</td>
      <td><span class="tag">IPv${a.family}</span></td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)">${fmtDate(a.first_seen)}</td>
      <td class="td-mono" style="font-size:0.75rem;color:var(--text-muted)">${fmtDate(a.last_seen)}</td>
    </tr>`).join('');

  // IP change detection: multiple distinct IPs = change occurred
  const unique = new Set(addrs.map(a => a.ip));
  const changeEl = document.getElementById('ip-change-info');
  if (changeEl) {
    if (unique.size > 1) {
      const sorted = [...addrs].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
      changeEl.innerHTML = `<div style="background:var(--color-warn-dim);border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius);padding:0.875rem">
        <div style="font-weight:600;color:var(--color-warn);font-size:0.8125rem;margin-bottom:0.5rem">⚠ IP change detected</div>
        <div style="font-size:0.75rem;color:var(--text-secondary)">Current: <code>${esc(sorted[0]?.ip)}</code></div>
        <div style="font-size:0.75rem;color:var(--text-secondary)">Previous: <code>${esc(sorted[1]?.ip)}</code></div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.375rem">Last change: ${fmtDate(sorted[0]?.first_seen)}</div>
      </div>`;
    } else {
      changeEl.textContent = 'No IP changes detected. Stable.';
    }
  }
}

// ── SSL tab ────────────────────────────────────────────────────────────────────
function renderSSL() {
  const el = document.getElementById('ssl-info');
  if (!el || !monitor) return;
  const m = monitor.monitor;
  if (!m?.ssl_expires_at) {
    el.innerHTML = `<p style="color:var(--text-muted);font-size:0.875rem">No SSL information available for this monitor type.</p>`;
    return;
  }
  const days = sslDaysRemaining(m.ssl_expires_at);
  const clr  = days < 0 ? 'var(--color-danger)' : days < 14 ? 'var(--color-danger)' : days < 30 ? 'var(--color-warn)' : 'var(--color-success)';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
      <span style="font-size:2rem">🔒</span>
      <div>
        <div style="font-weight:700;color:${clr};font-size:1rem">${days < 0 ? 'EXPIRED' : 'VALID'}</div>
        <div style="font-size:0.8125rem;color:var(--text-muted)">${Math.abs(days ?? 0)} days ${days < 0 ? 'ago' : 'remaining'}</div>
      </div>
    </div>
    <table class="data-table">
      <tbody>
        <tr><td style="color:var(--text-muted)">Expires</td><td class="td-mono">${fmtDate(m.ssl_expires_at)}</td></tr>
        <tr><td style="color:var(--text-muted)">Days remaining</td><td>${sslBadge(m.ssl_expires_at)}</td></tr>
      </tbody>
    </table>`;
}

// ── Config tab ─────────────────────────────────────────────────────────────────
function renderConfig() {
  const el = document.getElementById('config-info');
  if (!el || !monitor) return;
  const m = monitor.monitor;
  const rows = [
    ['Name',              m.name],
    ['Type',              m.type?.toUpperCase()],
    ['Enabled',           m.enabled ? 'Yes' : 'No'],
    ['Interval',          m.interval_seconds + 's'],
    ['Timeout',           m.timeout_ms + 'ms'],
    ['Failure threshold', m.failure_threshold],
    ['Recovery threshold',m.recovery_threshold],
    ['Degraded latency',  m.degraded_latency_ms ? m.degraded_latency_ms + 'ms' : '—'],
    ['Created',           fmtDateTime(m.created_at)],
    ['Last updated',      fmtDateTime(m.updated_at)],
  ];
  el.innerHTML = `
    <table class="data-table">
      <tbody>${rows.map(([k, v]) => `<tr><td style="color:var(--text-muted);width:180px">${esc(k)}</td><td class="td-mono">${esc(String(v ?? '—'))}</td></tr>`).join('')}</tbody>
    </table>
    <details style="margin-top:1rem">
      <summary style="cursor:pointer;font-size:0.8125rem;color:var(--text-muted)">Raw config</summary>
      <pre style="margin-top:0.75rem;font-size:0.75rem;color:var(--color-accent);background:var(--bg-page);padding:0.875rem;border-radius:var(--radius);overflow-x:auto">${esc(JSON.stringify(m.config ?? {}, null, 2))}</pre>
    </details>`;
}

// ── Actions ────────────────────────────────────────────────────────────────────
document.getElementById('run-check-btn')?.addEventListener('click', async () => {
  try {
    await Monitors.run(monitorId);
    Toast.success('Check queued');
    setTimeout(loadMonitor, 3_000);
  } catch (err) { Toast.error(err.message); }
});

document.getElementById('delete-monitor-btn')?.addEventListener('click', async () => {
  const { confirm } = await import('./components.js');
  const name = monitor?.monitor?.name ?? 'this monitor';
  const ok = await confirm(`Delete "${name}"? This cannot be undone.`, { danger: true, confirmText: 'Delete' });
  if (!ok) return;
  try {
    await Monitors.delete(monitorId);
    Toast.success('Monitor deleted');
    setTimeout(() => { location.href = 'monitors.html'; }, 800);
  } catch (err) { Toast.error(err.message); }
});

// ── SSE: live status updates ────────────────────────────────────────────────────
stream.start();
bindConnectionIndicator('connection-indicator');
stream.on('check.completed', (evt) => {
  if (evt.data?.monitorId !== monitorId) return;
  loadMonitor();
});
stream.on('monitor.status', (evt) => {
  if (evt.data?.monitorId !== monitorId) return;
  loadMonitor();
});

// ── Refresh ────────────────────────────────────────────────────────────────────
document.getElementById('refresh-btn')?.addEventListener('click', async () => {
  await loadMonitor();
  await loadLatency(currentWindow);
  Toast.success('Refreshed');
});
