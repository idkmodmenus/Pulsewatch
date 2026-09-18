/**
 * PulseWatch — server.js
 * Drives server.html: live metrics, historical charts, system info.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Servers } from './api.js';
import { stream, bindConnectionIndicator } from './websocket.js';
import {
  initSidebar, initGlobalSearch, initDropdowns, Toast,
  gaugeBar, confirm,
} from './components.js';
import { createServerChart } from './charts.js';
import {
  esc, fmtPercent, fmtUptimeSeconds, fmtBytes, fmtDateTime, timeAgo,
  statusDot, statusBadge, resourceClass, getParam,
} from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── Get server ID ─────────────────────────────────────────────────────────────
const serverId = getParam('id');
if (!serverId) { location.href = 'servers.html'; throw new Error('No id'); }

// ── State ─────────────────────────────────────────────────────────────────────
let serverData    = null;
let cpuMemChart   = null;
let diskLoadChart = null;
let netChart      = null;
let currentWindow = '24h';

// ── Load ──────────────────────────────────────────────────────────────────────
async function load(win = '24h') {
  currentWindow = win;
  try {
    const data = await Servers.get(serverId, win);
    serverData = data;
    renderHeader(data.agent);
    renderLiveMetrics(data.latest ?? data.agent);
    renderCharts(data.series ?? []);
    renderInfo(data.agent);
    document.title = `PulseWatch — ${data.agent?.name ?? 'Server'}`;
    document.getElementById('breadcrumb-name').textContent = data.agent?.name ?? '—';
  } catch (err) {
    Toast.error('Failed to load server: ' + err.message);
  }
}

// ── Header ────────────────────────────────────────────────────────────────────
function renderHeader(agent) {
  if (!agent) return;
  document.getElementById('server-title').textContent = agent.name ?? '—';
  document.getElementById('server-host').textContent  = agent.hostname ?? '—';
  const dotEl    = document.getElementById('server-status-dot');
  const badgeEl  = document.getElementById('server-status-badge');
  if (dotEl)   dotEl.className   = 'status-dot status-' + (agent.status === 'online' ? 'up' : 'offline');
  if (badgeEl) badgeEl.innerHTML = statusBadge(agent.status === 'online' ? 'up' : 'offline');
}

// ── Live metrics ──────────────────────────────────────────────────────────────
function renderLiveMetrics(m) {
  if (!m) return;
  const thr = serverData?.agent?.thresholds ?? { cpu: 90, memory: 90, disk: 90 };

  const cpu  = m.cpu  != null ? Math.round(parseFloat(m.cpu))  : null;
  const mem  = m.memory != null ? Math.round(parseFloat(m.memory)) : null;
  const disk = m.disk != null ? Math.round(parseFloat(m.disk)) : null;
  const load = m.load1 != null ? parseFloat(m.load1).toFixed(2) : null;

  const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v ?? '—'; };
  const cpuCls  = cpu  != null ? resourceClass(cpu,  thr.cpu  - 15, thr.cpu)  : '';
  const memCls  = mem  != null ? resourceClass(mem,  thr.memory - 15, thr.memory) : '';
  const diskCls = disk != null ? resourceClass(disk, thr.disk - 15, thr.disk) : '';

  setEl('live-cpu',  cpu  != null ? cpu  + '%' : '—');
  setEl('live-mem',  mem  != null ? mem  + '%' : '—');
  setEl('live-disk', disk != null ? disk + '%' : '—');
  setEl('live-load', load ?? '—');
  setEl('live-uptime', m.uptime_seconds ? 'Up ' + fmtUptimeSeconds(m.uptime_seconds) : '');

  for (const [id, v, cls] of [['live-cpu','kpi-card__value',cpuCls],['live-mem','kpi-card__value',memCls],['live-disk','kpi-card__value',diskCls]]) {
    const el = document.getElementById(id);
    if (el) el.className = 'kpi-card__value ' + cls;
  }

  document.getElementById('live-cpu-bar').innerHTML  = cpu  != null ? gaugeBar(cpu,  thr.cpu  - 15, thr.cpu)  : '';
  document.getElementById('live-mem-bar').innerHTML  = mem  != null ? gaugeBar(mem,  thr.memory - 15, thr.memory) : '';
  document.getElementById('live-disk-bar').innerHTML = disk != null ? gaugeBar(disk, thr.disk - 15, thr.disk) : '';
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts(series) {
  if (!series.length) return;
  if (cpuMemChart) {
    cpuMemChart.update(series);
  } else {
    cpuMemChart   = createServerChart('cpu-mem-chart',   series, ['cpu', 'memory']);
  }
  if (diskLoadChart) {
    diskLoadChart.update(series);
  } else {
    diskLoadChart = createServerChart('disk-load-chart', series, ['disk', 'load1']);
  }
  // Network: rx_delta + tx_delta
  const hasSomeNet = series.some(s => s.rx_delta != null || s.tx_delta != null);
  if (hasSomeNet) {
    if (netChart) {
      netChart.update(series);
    } else {
      netChart = createServerChart('net-chart', series, ['rx_delta', 'tx_delta']);
    }
  }
}

// ── Server info panel ──────────────────────────────────────────────────────────
function renderInfo(agent) {
  const el = document.getElementById('server-info-body');
  if (!el || !agent) return;
  const os   = agent.os ?? {};
  const rows = [
    ['Status',          statusBadge(agent.status === 'online' ? 'up' : 'offline')],
    ['Hostname',        esc(agent.hostname ?? '—')],
    ['IPv4',            (agent.ipv4 ?? []).map(esc).join(', ') || '—'],
    ['IPv6',            (agent.ipv6 ?? []).join(', ') || '—'],
    ['OS',              esc(os.platform ?? os.type ?? '—')],
    ['OS Version',      esc(os.release ?? os.version ?? '—')],
    ['Architecture',    esc(os.arch ?? '—')],
    ['Agent Created',   fmtDateTime(agent.created_at)],
    ['Last Heartbeat',  agent.last_seen_at ? timeAgo(agent.last_seen_at) : 'Never'],
    ['Heartbeat Timeout', agent.heartbeat_timeout_seconds + 's'],
  ];
  el.innerHTML = `
    <table class="data-table">
      <tbody>${rows.map(([k, v]) => `<tr><td style="color:var(--text-muted);width:150px">${esc(k)}</td><td>${v}</td></tr>`).join('')}</tbody>
    </table>`;
}

// ── Window range buttons ───────────────────────────────────────────────────────
document.querySelectorAll('.range-btn[data-window]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn[data-window]').forEach(b => b.classList.remove('range-btn--active'));
    btn.classList.add('range-btn--active');
    load(btn.dataset.window);
  });
});

// ── Delete server ─────────────────────────────────────────────────────────────
document.getElementById('delete-server-btn')?.addEventListener('click', async () => {
  const name = serverData?.agent?.name ?? 'this server';
  const ok   = await confirm(`Remove "${name}"? All metric history will be deleted.`, { danger: true, confirmText: 'Remove' });
  if (!ok) return;
  try {
    await Servers.delete(serverId);
    Toast.success('Server removed');
    setTimeout(() => { location.href = 'servers.html'; }, 800);
  } catch (err) { Toast.error(err.message); }
});

// ── SSE live telemetry ────────────────────────────────────────────────────────
stream.start();
bindConnectionIndicator('connection-indicator');
stream.on('agent.telemetry', (evt) => {
  if (evt.data?.agentId !== serverId) return;
  if (serverData) {
    if (!serverData.latest) serverData.latest = {};
    serverData.latest.cpu    = evt.data.cpu;
    serverData.latest.memory = evt.data.memory;
    serverData.latest.disk   = evt.data.disk;
    renderLiveMetrics(serverData.latest);
  }
});
stream.on('agent.offline', (evt) => {
  if (evt.data?.agentId !== serverId) return;
  if (serverData?.agent) {
    serverData.agent.status = 'offline';
    renderHeader(serverData.agent);
    Toast.warn('Server went offline');
  }
});

// ── Refresh ────────────────────────────────────────────────────────────────────
document.getElementById('refresh-btn')?.addEventListener('click', () => { load(currentWindow); Toast.success('Refreshed'); });

await load('24h');
