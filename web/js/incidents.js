/**
 * PulseWatch — incidents.js
 * Drives incidents.html: incident list, filters, KPI, detail modal with timeline.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Incidents } from './api.js';
import { stream, bindConnectionIndicator } from './websocket.js';
import {
  initSidebar, initGlobalSearch, initDropdowns, Toast,
  emptyState, errorState, Modal,
} from './components.js';
import {
  esc, fmtDuration, fmtDateTime, timeAgo, statusBadge, typeTag,
  severityBadge,
} from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── State ──────────────────────────────────────────────────────────────────────
let allIncidents = [];
let statusFilter = '';
let offset       = 0;
const PAGE_SIZE  = 50;

// ── Load ───────────────────────────────────────────────────────────────────────
async function load(append = false) {
  if (!append) { allIncidents = []; offset = 0; }
  try {
    const data = await Incidents.list({ status: statusFilter || undefined, limit: PAGE_SIZE });
    const items = data.incidents ?? [];
    if (append) {
      allIncidents = [...allIncidents, ...items];
    } else {
      allIncidents = items;
    }
    renderKPI(allIncidents);
    renderList(allIncidents);
    updateSub(allIncidents);
    document.getElementById('load-more-incidents').style.display = items.length < PAGE_SIZE ? 'none' : '';
  } catch (err) {
    const { html, bindRetry } = errorState(err, () => load(false));
    document.getElementById('incidents-container').innerHTML = html;
    bindRetry(document.getElementById('incidents-container'));
    Toast.error('Failed to load incidents: ' + err.message);
  }
}

// ── KPI ────────────────────────────────────────────────────────────────────────
function renderKPI(items) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v ?? '—'; };
  const open  = items.filter(i => i.status === 'open').length;
  const ack   = items.filter(i => i.status === 'acknowledged').length;
  const res   = items.filter(i => i.status === 'resolved').length;
  const withDur = items.filter(i => i.duration_seconds).map(i => i.duration_seconds);
  const avgDur  = withDur.length ? Math.round(withDur.reduce((s, n) => s + n, 0) / withDur.length) : null;
  set('inc-kpi-open',     open);
  set('inc-kpi-ack',      ack);
  set('inc-kpi-resolved', res);
  set('inc-kpi-mttr',     avgDur ? fmtDuration(avgDur) : '—');
}

// ── List ───────────────────────────────────────────────────────────────────────
function renderList(items) {
  const el = document.getElementById('incidents-container');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = emptyState({
      title: statusFilter ? `No ${statusFilter} incidents` : 'No incidents',
      message: 'All clear — no incidents found.',
    });
    return;
  }
  el.innerHTML = items.map(i => incidentRow(i)).join('');
  el.querySelectorAll('.incident-item').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.incidentId));
  });
}

function incidentRow(i) {
  const dotColor = i.status === 'open' ? 'var(--color-danger)'
    : i.status === 'acknowledged' ? 'var(--color-warn)' : 'var(--color-muted)';
  return `
  <div class="incident-item" data-incident-id="${esc(String(i.id))}" style="cursor:pointer">
    <span class="status-dot" style="background:${dotColor};margin-top:4px"></span>
    <div style="min-width:0">
      <div class="incident-title">${esc(i.monitor_name)} <span style="opacity:0.5">—</span> ${esc(i.cause ?? 'Incident')}</div>
      <div class="incident-meta">
        ${typeTag(i.monitor_type)}
        ${severityBadge(i.severity)}
        <span>Started ${timeAgo(i.started_at)}</span>
        ${i.duration_seconds ? `<span>Duration: ${fmtDuration(i.duration_seconds)}</span>` : ''}
        ${i.detected_after_failures ? `<span>${i.detected_after_failures} consecutive failures</span>` : ''}
      </div>
      ${i.cause ? `<div class="incident-cause">${esc(i.cause)}</div>` : ''}
    </div>
    <div>${statusBadge(i.status)}</div>
  </div>`;
}

function updateSub(items) {
  const el = document.getElementById('incident-count-sub');
  if (el) el.textContent = `${items.length} incidents shown`;
}

// ── Detail modal ───────────────────────────────────────────────────────────────
const detailModal = document.getElementById('incident-detail-modal');
function openDetailModal()  { detailModal?.classList.add('modal-backdrop--open');  document.body.classList.add('modal-open');  }
function closeDetailModal() { detailModal?.classList.remove('modal-backdrop--open'); document.body.classList.remove('modal-open'); }

detailModal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', closeDetailModal));
detailModal?.addEventListener('click', e => { if (e.target === detailModal) closeDetailModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetailModal(); });

async function openDetail(id) {
  const titleEl  = document.getElementById('incident-detail-title');
  const bodyEl   = document.getElementById('incident-detail-body');
  const footerEl = document.getElementById('incident-detail-footer');
  if (titleEl)  titleEl.textContent = 'Loading…';
  if (bodyEl)   bodyEl.innerHTML    = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">Loading…</div>';
  if (footerEl) footerEl.innerHTML  = '';
  openDetailModal();

  try {
    const data     = await Incidents.get(id);
    const incident = data.incident;
    const events   = data.events ?? [];

    if (titleEl) titleEl.textContent = `${incident.monitor_name} — ${incident.cause ?? 'Incident'}`;

    // Timeline
    const tlItems = events.map(e => {
      const dotCls = e.kind === 'recovered' || e.kind === 'resolved' ? 'timeline-dot--success'
        : e.kind === 'opened' ? 'timeline-dot--danger'
        : e.kind === 'acknowledged' ? 'timeline-dot--warn'
        : 'timeline-dot--info';
      return `
      <div class="timeline-item">
        <div class="timeline-dot ${dotCls}"></div>
        <div class="timeline-content">
          <div class="timeline-event">${esc(e.message ?? e.kind)}</div>
          <div class="timeline-time">${fmtDateTime(e.at)}</div>
        </div>
      </div>`;
    }).join('');

    if (bodyEl) bodyEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1.25rem">
        <div><div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:0.25rem">Status</div>${statusBadge(incident.status)}</div>
        <div><div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:0.25rem">Severity</div>${severityBadge(incident.severity)}</div>
        <div><div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:0.25rem">Started</div><div style="font-size:0.8125rem;font-family:var(--font-mono)">${fmtDateTime(incident.started_at)}</div></div>
        <div><div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:0.25rem">Resolved</div><div style="font-size:0.8125rem;font-family:var(--font-mono)">${incident.resolved_at ? fmtDateTime(incident.resolved_at) : '—'}</div></div>
        <div><div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:0.25rem">Duration</div><div style="font-size:0.8125rem">${incident.duration_seconds ? fmtDuration(incident.duration_seconds) : 'Ongoing'}</div></div>
        <div><div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:0.25rem">Failures</div><div style="font-size:0.8125rem">${incident.detected_after_failures ?? '—'}</div></div>
      </div>
      ${incident.cause ? `<div style="background:var(--color-danger-dim);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius);padding:0.75rem;margin-bottom:1.25rem;font-family:var(--font-mono);font-size:0.8125rem;color:var(--color-danger)">${esc(incident.cause)}</div>` : ''}
      <div class="section-title" style="margin-bottom:0.75rem">Timeline</div>
      <div class="timeline">${tlItems || '<div style="color:var(--text-muted);font-size:0.8125rem">No events recorded.</div>'}</div>`;

    // Footer actions
    if (footerEl && incident.status === 'open') {
      footerEl.innerHTML = `
        <a href="monitor.html?id=${esc(incident.monitor_id)}" class="btn btn--ghost">View Monitor</a>
        <button class="btn btn--primary" id="ack-btn">Acknowledge</button>`;
      footerEl.querySelector('#ack-btn')?.addEventListener('click', async () => {
        try {
          await Incidents.acknowledge(id);
          Toast.success('Incident acknowledged');
          closeDetailModal();
          await load(false);
        } catch (err) { Toast.error(err.message); }
      });
    } else if (footerEl) {
      footerEl.innerHTML = `<a href="monitor.html?id=${esc(incident.monitor_id)}" class="btn btn--ghost">View Monitor</a>`;
    }
  } catch (err) {
    if (bodyEl) bodyEl.innerHTML = `<div style="padding:1rem;color:var(--color-danger)">${esc(err.message)}</div>`;
  }
}

// ── Status filter chips ────────────────────────────────────────────────────────
document.getElementById('inc-status-chips')?.addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('#inc-status-chips .filter-chip').forEach(c => c.classList.remove('filter-chip--active'));
  chip.classList.add('filter-chip--active');
  statusFilter = chip.dataset.filter;
  load(false);
});

// ── Load more ──────────────────────────────────────────────────────────────────
document.getElementById('load-more-incidents')?.addEventListener('click', () => load(true));

// ── SSE ────────────────────────────────────────────────────────────────────────
stream.start();
bindConnectionIndicator('connection-indicator');
stream.on('incident.opened',   () => load(false));
stream.on('incident.resolved', () => load(false));

// ── Refresh ────────────────────────────────────────────────────────────────────
document.getElementById('refresh-btn')?.addEventListener('click', () => { load(false); Toast.success('Refreshed'); });

await load(false);
