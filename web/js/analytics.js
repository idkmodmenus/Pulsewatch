/**
 * PulseWatch — analytics.js
 * Drives analytics.html: aggregate KPI, latency chart, per-monitor uptime table.
 * Uses /api/dashboard for aggregate data and /api/monitors for per-monitor breakdown.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Dashboard, Monitors } from './api.js';
import { stream, bindConnectionIndicator } from './websocket.js';
import { initSidebar, initGlobalSearch, initDropdowns, Toast, emptyState } from './components.js';
import { createAnalyticsLatencyChart } from './charts.js';
import {
  esc, fmtMs, fmtUptime, fmt, statusDot, typeTag,
  uptimeClass, latencyClass,
} from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── State ──────────────────────────────────────────────────────────────────────
let dashData    = null;
let monitorsData = [];
let latChart    = null;
let currentWindow = '30d';
let selectedMonitorId = '';

// ── Load dashboard aggregate ────────────────────────────────────────────────────
async function loadDash() {
  try {
    dashData = await Dashboard.get();
    renderKPI(dashData);
    renderChart(dashData.series ?? []);
  } catch (err) {
    Toast.error('Failed to load analytics: ' + err.message);
  }
}

// ── Load monitors for per-monitor table + selector ──────────────────────────────
async function loadMonitors() {
  try {
    const data = await Monitors.list();
    monitorsData = data.monitors ?? [];
    renderMonitorSelector(monitorsData);
    renderMonitorTable(monitorsData);
  } catch (err) {
    Toast.error('Failed to load monitor list: ' + err.message);
  }
}

// ── KPI ────────────────────────────────────────────────────────────────────────
function renderKPI(d) {
  const up  = d.uptime  ?? {};
  const lat = d.latency ?? {};

  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v ?? '—'; };

  set('an-uptime',       fmtUptime(up.uptime));
  set('an-uptime-sub',   `${fmt(up.checks)} total checks`);

  set('an-checks',       fmt(up.checks));
  set('an-checks-sub',   up.checks ? (((up.checks - up.failures) / up.checks * 100).toFixed(2) + '% successful') : '');

  set('an-failures',     fmt(up.failures));
  set('an-failures-sub', up.checks && up.failures ? (up.failures / up.checks * 100).toFixed(3) + '% failure rate' : '');

  set('an-avg-lat',  fmtMs(lat.avg_ms));
  set('an-p50',      fmtMs(lat.p50_ms));
  set('an-p95',      fmtMs(lat.p95_ms));
  set('an-p99',      fmtMs(lat.p99_ms));

  const open = (d.incidents ?? []).filter(i => i.status === 'open').length;
  set('an-incidents',     d.incidents?.length ?? 0);
  set('an-incidents-sub', open ? `${open} currently open` : 'None currently open');
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart(series) {
  if (!series.length) return;
  if (latChart) {
    latChart.update(series);
  } else {
    latChart = createAnalyticsLatencyChart('analytics-latency-chart', series);
  }
}

// ── Monitor selector (for per-monitor chart — future enhancement) ───────────────
function renderMonitorSelector(monitors) {
  const sel = document.getElementById('an-monitor-select');
  if (!sel) return;
  const opts = monitors.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  sel.innerHTML = `<option value="">All monitors (avg)</option>${opts}`;
  sel.addEventListener('change', () => {
    selectedMonitorId = sel.value;
    // If a specific monitor is selected, load its latency series instead
    if (selectedMonitorId) {
      loadMonitorLatency(selectedMonitorId);
    } else {
      renderChart(dashData?.series ?? []);
    }
  });
}

async function loadMonitorLatency(id) {
  try {
    const winMap = { '24h': '24h', '7d': '7d', '30d': '30d', '90d': '30d' };
    const data = await import('./api.js').then(m => m.Monitors.latency(id, winMap[currentWindow] ?? '24h'));
    renderChart(data.series ?? []);
  } catch {}
}

// ── Per-monitor table ─────────────────────────────────────────────────────────
function renderMonitorTable(monitors) {
  const tbody = document.getElementById('analytics-table-body');
  if (!tbody) return;
  if (!monitors.length) {
    tbody.innerHTML = `<tr><td colspan="9">${emptyState({ title: 'No monitors' })}</td></tr>`;
    return;
  }
  tbody.innerHTML = monitors.map(m => {
    const upMonth = parseFloat(m.uptime?.month ?? 100);
    const checks  = parseInt(m.checks ?? 0, 10);
    const failures= parseInt(m.failures ?? 0, 10);
    const failPct = checks ? (failures / checks * 100).toFixed(3) + '%' : '—';
    const upCls   = uptimeClass(upMonth);
    const latCls  = latencyClass(m.last_latency_ms);
    return `
    <tr onclick="location.href='monitor.html?id=${esc(m.id)}'" class="cursor-pointer">
      <td>${statusDot(m.status)}</td>
      <td class="td-primary truncate" style="max-width:180px">${esc(m.name)}</td>
      <td>${typeTag(m.type)}</td>
      <td class="${upCls}" style="font-family:var(--font-mono);font-size:0.8125rem;font-weight:700">${fmtUptime(upMonth)}</td>
      <td class="td-mono" style="font-size:0.8125rem">${fmt(checks) || '—'}</td>
      <td class="td-mono" style="font-size:0.8125rem;color:var(--color-danger)">${fmt(failures) || '—'}</td>
      <td class="td-mono" style="font-size:0.8125rem">${failPct}</td>
      <td class="td-mono ${latCls}" style="font-size:0.8125rem">${fmtMs(m.last_latency_ms)}</td>
      <td class="td-mono" style="font-size:0.8125rem;color:var(--color-warn)">—</td>
    </tr>`;
  }).join('');
}

// ── Date range buttons ────────────────────────────────────────────────────────
document.getElementById('analytics-range-btns')?.addEventListener('click', e => {
  const btn = e.target.closest('.range-btn');
  if (!btn) return;
  document.querySelectorAll('#analytics-range-btns .range-btn').forEach(b => b.classList.remove('range-btn--active'));
  btn.classList.add('range-btn--active');
  currentWindow = btn.dataset.window;
  loadDash();
  if (selectedMonitorId) loadMonitorLatency(selectedMonitorId);
});

// ── SSE ────────────────────────────────────────────────────────────────────────
stream.start();
bindConnectionIndicator('connection-indicator');
stream.on('check.completed', () => {
  // Soft-refresh aggregate data every few checks
  clearTimeout(window._analyticsTimer);
  window._analyticsTimer = setTimeout(() => loadDash(), 30_000);
});

// ── Refresh ────────────────────────────────────────────────────────────────────
document.getElementById('refresh-btn')?.addEventListener('click', () => {
  loadDash(); loadMonitors(); Toast.success('Refreshed');
});

// ── Init ──────────────────────────────────────────────────────────────────────
await Promise.all([loadDash(), loadMonitors()]);
