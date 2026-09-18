/**
 * PulseWatch — settings.js
 * Drives settings.html: notification channels, alert rules,
 * maintenance windows, API keys, delivery log.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { Notifications, Maintenance, ApiKeys, Monitors } from './api.js';
import { initSidebar, initGlobalSearch, initDropdowns, initTabs, initCopyButtons, Toast, emptyState, confirm } from './components.js';
import { esc, fmtDateTime, fmtISOLocal, timeAgo } from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
initCopyButtons();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── Tab switching ──────────────────────────────────────────────────────────────
const tabList = document.querySelector('[role="tablist"]');
initTabs(tabList, async (tab) => {
  if (tab === 'notifications') await loadChannels();
  if (tab === 'alert-rules')   await loadRules();
  if (tab === 'maintenance')   await loadMaintenance();
  if (tab === 'apikeys')       await loadApiKeys();
  if (tab === 'deliveries')    await loadDeliveries();
});

// ── Handle URL hash (e.g. settings.html#maintenance) ──────────────────────────
const hash = window.location.hash.slice(1);
if (hash) {
  const tab = tabList?.querySelector(`[data-tab="${hash}"]`);
  if (tab) tab.click();
}

// ── State ──────────────────────────────────────────────────────────────────────
let channels = [];
let rules    = [];
let eventTypes = [];

// ══ NOTIFICATION CHANNELS ════════════════════════════════════════════════════

async function loadChannels() {
  const el = document.getElementById('channels-list');
  if (!el) return;
  try {
    const data = await Notifications.listChannels();
    channels   = data.channels  ?? [];
    renderChannels(channels);
  } catch (err) { el.innerHTML = `<div style="padding:1rem;color:var(--color-danger)">${esc(err.message)}</div>`; }
}

function renderChannels(list) {
  const el = document.getElementById('channels-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = emptyState({ title: 'No notification channels', message: 'Add Email, Slack, Discord or a Webhook.' });
    return;
  }
  el.innerHTML = list.map(ch => `
    <div class="card" style="margin-bottom:0.75rem">
      <div class="card__header">
        <div style="display:flex;align-items:center;gap:0.625rem">
          <span style="font-size:1.25rem">${channelIcon(ch.type)}</span>
          <div>
            <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary)">${esc(ch.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${esc(ch.type?.toUpperCase())}</div>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center">
          ${ch.enabled ? '<span class="badge badge--success">Enabled</span>' : '<span class="badge badge--muted">Disabled</span>'}
          <button class="btn btn--ghost btn--sm" onclick="testChannel('${esc(ch.id)}','${esc(ch.name)}')">Test</button>
          <button class="btn btn--danger btn--sm" onclick="deleteChannel('${esc(ch.id)}','${esc(ch.name)}')">Delete</button>
        </div>
      </div>
    </div>`).join('');
}

function channelIcon(type) {
  return { email: '📧', slack: '💬', discord: '🎮', webhook: '🔗' }[type] ?? '🔔';
}

// Add channel modal
const chModal = document.getElementById('channel-modal');
document.getElementById('add-channel-btn')?.addEventListener('click', () => {
  chModal?.classList.add('modal-backdrop--open'); document.body.classList.add('modal-open');
  renderChannelConfigFields(document.getElementById('ch-type').value);
});
chModal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', () => closeModal(chModal)));
chModal?.addEventListener('click', e => { if (e.target === chModal) closeModal(chModal); });

document.getElementById('ch-type')?.addEventListener('change', e => renderChannelConfigFields(e.target.value));

function renderChannelConfigFields(type) {
  const el = document.getElementById('ch-config-fields');
  if (!el) return;
  if (type === 'email') {
    el.innerHTML = `<div class="form-group"><label class="form-label" for="ch-email">Email address</label><input class="form-input" id="ch-email" type="email" placeholder="alerts@example.com" /></div>`;
  } else if (type === 'slack') {
    el.innerHTML = `<div class="form-group"><label class="form-label" for="ch-webhook">Slack Webhook URL</label><input class="form-input" id="ch-webhook" type="url" placeholder="https://hooks.slack.com/…" /></div>`;
  } else if (type === 'discord') {
    el.innerHTML = `<div class="form-group"><label class="form-label" for="ch-webhook">Discord Webhook URL</label><input class="form-input" id="ch-webhook" type="url" placeholder="https://discord.com/api/webhooks/…" /></div>`;
  } else if (type === 'webhook') {
    el.innerHTML = `<div class="form-group"><label class="form-label" for="ch-webhook">Webhook URL</label><input class="form-input" id="ch-webhook" type="url" placeholder="https://…" /></div>`;
  }
}

document.getElementById('save-channel-btn')?.addEventListener('click', async () => {
  const errEl = document.getElementById('ch-form-error');
  errEl.style.display = 'none';
  const type  = document.getElementById('ch-type').value;
  const name  = document.getElementById('ch-name').value.trim();
  if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }

  const config = {};
  if (type === 'email') {
    const email = document.getElementById('ch-email')?.value.trim();
    if (!email) { errEl.textContent = 'Email address is required.'; errEl.style.display = 'block'; return; }
    config.to = email;
  } else {
    const url = document.getElementById('ch-webhook')?.value.trim();
    if (!url) { errEl.textContent = 'Webhook URL is required.'; errEl.style.display = 'block'; return; }
    config.webhookUrl = url;
  }

  const btn = document.getElementById('save-channel-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await Notifications.createChannel({ type, name, config, enabled: true });
    Toast.success('Channel saved');
    closeModal(chModal);
    await loadChannels();
  } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Save Channel'; }
});

window.testChannel = async (id, name) => {
  try {
    const res = await Notifications.testChannel(id);
    if (res.delivered) Toast.success(`Test sent to "${name}"`);
    else Toast.error(`Test failed: ${res.error ?? 'unknown error'}`);
  } catch (err) { Toast.error(err.message); }
};

window.deleteChannel = async (id, name) => {
  const ok = await confirm(`Delete channel "${name}"?`, { danger: true, confirmText: 'Delete' });
  if (!ok) return;
  try { await Notifications.deleteChannel(id); Toast.success('Channel deleted'); await loadChannels(); }
  catch (err) { Toast.error(err.message); }
};

// ══ ALERT RULES ══════════════════════════════════════════════════════════════

async function loadRules() {
  const el = document.getElementById('rules-list');
  if (!el) return;
  try {
    const data = await Notifications.listRules();
    rules      = data.rules      ?? [];
    eventTypes = data.eventTypes ?? [];
    // Ensure channels loaded
    if (!channels.length) await loadChannels();
    renderRules(rules);
  } catch (err) { el.innerHTML = `<div style="padding:1rem;color:var(--color-danger)">${esc(err.message)}</div>`; }
}

function renderRules(list) {
  const el = document.getElementById('rules-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = emptyState({ title: 'No alert rules', message: 'Rules define what events trigger which notification channels.' });
    return;
  }
  el.innerHTML = list.map(r => `
    <div class="card" style="margin-bottom:0.75rem">
      <div class="card__header">
        <div>
          <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary)">${esc(r.name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">
            → ${esc(r.channel_name)} (${esc(r.channel_type)}) · Cooldown: ${r.cooldown_seconds}s
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.375rem;margin-top:0.5rem">
            ${(r.event_types ?? []).map(et => `<span class="tag">${esc(et)}</span>`).join('')}
          </div>
        </div>
        <button class="btn btn--danger btn--sm" onclick="deleteRule('${esc(r.id)}','${esc(r.name)}')">Delete</button>
      </div>
    </div>`).join('');
}

const ruleModal = document.getElementById('rule-modal');
document.getElementById('add-rule-btn')?.addEventListener('click', async () => {
  if (!channels.length) await loadChannels();
  const chSel = document.getElementById('rule-channel');
  if (chSel) chSel.innerHTML = channels.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') || '<option>No channels available</option>';
  renderEventTypeChecks();
  ruleModal?.classList.add('modal-backdrop--open'); document.body.classList.add('modal-open');
});
ruleModal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', () => closeModal(ruleModal)));
ruleModal?.addEventListener('click', e => { if (e.target === ruleModal) closeModal(ruleModal); });

function renderEventTypeChecks() {
  const el = document.getElementById('rule-events');
  if (!el) return;
  const ALL_EVENTS = ['monitor.down','monitor.recovered','monitor.degraded','monitor.high_latency','ssl.expiring','dns.changed','agent.cpu','agent.memory','agent.disk','agent.disconnected'];
  el.innerHTML = ALL_EVENTS.map(et => `
    <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;color:var(--text-secondary);cursor:pointer">
      <input type="checkbox" value="${esc(et)}" style="accent-color:var(--color-accent)" />
      ${esc(et)}
    </label>`).join('');
}

document.getElementById('save-rule-btn')?.addEventListener('click', async () => {
  const errEl = document.getElementById('rule-form-error');
  errEl.style.display = 'none';
  const name       = document.getElementById('rule-name').value.trim();
  const channelId  = document.getElementById('rule-channel').value;
  const cooldown   = parseInt(document.getElementById('rule-cooldown').value, 10) || 900;
  const evtTypes   = [...document.querySelectorAll('#rule-events input:checked')].map(i => i.value);
  if (!name) { errEl.textContent = 'Name required.'; errEl.style.display = 'block'; return; }
  if (!evtTypes.length) { errEl.textContent = 'Select at least one event type.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('save-rule-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await Notifications.createRule({ name, channelId, eventTypes: evtTypes, cooldownSeconds: cooldown });
    Toast.success('Alert rule created');
    closeModal(ruleModal);
    await loadRules();
  } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Save Rule'; }
});

window.deleteRule = async (id, name) => {
  const ok = await confirm(`Delete rule "${name}"?`, { danger: true, confirmText: 'Delete' });
  if (!ok) return;
  try { await Notifications.deleteRule(id); Toast.success('Rule deleted'); await loadRules(); }
  catch (err) { Toast.error(err.message); }
};

// ══ MAINTENANCE WINDOWS ══════════════════════════════════════════════════════

async function loadMaintenance() {
  const el = document.getElementById('maintenance-list');
  if (!el) return;
  try {
    const data = await Maintenance.list();
    renderMaintenance(data.windows ?? []);
  } catch (err) { el.innerHTML = `<div style="padding:1rem;color:var(--color-danger)">${esc(err.message)}</div>`; }
}

function renderMaintenance(list) {
  const el = document.getElementById('maintenance-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = emptyState({ title: 'No maintenance windows', message: 'Schedule maintenance to suppress downtime alerts.' });
    return;
  }
  const now = new Date();
  el.innerHTML = list.map(w => {
    const start = new Date(w.starts_at), end = new Date(w.ends_at);
    const isActive    = start <= now && end >= now;
    const isScheduled = start > now;
    const badgeCls = isActive ? 'badge--warn' : isScheduled ? 'badge--info' : 'badge--muted';
    const badgeText = isActive ? 'Active' : isScheduled ? 'Scheduled' : 'Completed';
    return `
    <div class="card" style="margin-bottom:0.75rem">
      <div class="card__header">
        <div>
          <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary)">${esc(w.name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">
            ${fmtDateTime(w.starts_at)} → ${fmtDateTime(w.ends_at)}
            ${w.suppress_checks ? ' · Checks suppressed' : ''}
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <span class="badge ${badgeCls}">${badgeText}</span>
          ${isScheduled || isActive ? `<button class="btn btn--danger btn--sm" onclick="deleteMaintenance('${esc(w.id)}','${esc(w.name)}')">Cancel</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

const maintModal = document.getElementById('maintenance-modal');
document.getElementById('add-maintenance-btn')?.addEventListener('click', () => {
  // Pre-fill start to now+1h, end to now+2h
  const start = new Date(Date.now() + 3_600_000);
  const end   = new Date(Date.now() + 7_200_000);
  const si    = document.getElementById('maint-start');
  const ei    = document.getElementById('maint-end');
  if (si) si.value = fmtISOLocal(start);
  if (ei) ei.value = fmtISOLocal(end);
  maintModal?.classList.add('modal-backdrop--open'); document.body.classList.add('modal-open');
});
maintModal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', () => closeModal(maintModal)));
maintModal?.addEventListener('click', e => { if (e.target === maintModal) closeModal(maintModal); });

document.getElementById('save-maintenance-btn')?.addEventListener('click', async () => {
  const errEl   = document.getElementById('maint-form-error');
  errEl.style.display = 'none';
  const name     = document.getElementById('maint-name').value.trim();
  const startsAt = document.getElementById('maint-start').value;
  const endsAt   = document.getElementById('maint-end').value;
  const suppress = document.getElementById('maint-suppress').checked;
  if (!name || !startsAt || !endsAt) { errEl.textContent = 'All fields required.'; errEl.style.display = 'block'; return; }
  if (new Date(endsAt) <= new Date(startsAt)) { errEl.textContent = 'End must be after start.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('save-maintenance-btn');
  btn.disabled = true; btn.textContent = 'Scheduling…';
  try {
    await Maintenance.create({ name, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), suppressChecks: suppress });
    Toast.success('Maintenance scheduled');
    closeModal(maintModal);
    await loadMaintenance();
  } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Schedule'; }
});

window.deleteMaintenance = async (id, name) => {
  const ok = await confirm(`Cancel maintenance "${name}"?`, { confirmText: 'Cancel Maintenance' });
  if (!ok) return;
  try { await Maintenance.delete(id); Toast.success('Maintenance cancelled'); await loadMaintenance(); }
  catch (err) { Toast.error(err.message); }
};

// ══ API KEYS ══════════════════════════════════════════════════════════════════

async function loadApiKeys() {
  const el = document.getElementById('apikeys-list');
  if (!el) return;
  try {
    const data = await ApiKeys.list();
    renderApiKeys(data.keys ?? []);
  } catch (err) { el.innerHTML = `<div style="padding:1rem;color:var(--color-danger)">${esc(err.message)}</div>`; }
}

function renderApiKeys(keys) {
  const el = document.getElementById('apikeys-list');
  if (!el) return;
  if (!keys.length) {
    el.innerHTML = emptyState({ title: 'No API keys', message: 'Create a key to access the PulseWatch API programmatically.' });
    return;
  }
  el.innerHTML = keys.map(k => `
    <div class="card" style="margin-bottom:0.75rem">
      <div class="card__header">
        <div>
          <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary)">${esc(k.name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">
            Role: ${esc(k.role)} · Prefix: <code>${esc(k.prefix)}</code>
            ${k.last_used_at ? ' · Last used: ' + timeAgo(k.last_used_at) : ''} · Created ${fmtDateTime(k.created_at)}
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center">
          ${k.revoked_at ? '<span class="badge badge--muted">Revoked</span>' : '<span class="badge badge--success">Active</span>'}
          ${!k.revoked_at ? `<button class="btn btn--danger btn--sm" onclick="revokeKey('${esc(k.id)}','${esc(k.name)}')">Revoke</button>` : ''}
        </div>
      </div>
    </div>`).join('');
}

const keyModal = document.getElementById('apikey-modal');
document.getElementById('add-apikey-btn')?.addEventListener('click', () => {
  document.getElementById('key-result').style.display = 'none';
  document.getElementById('save-apikey-btn').style.display = '';
  document.getElementById('key-name').value = '';
  keyModal?.classList.add('modal-backdrop--open'); document.body.classList.add('modal-open');
});
keyModal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', () => closeModal(keyModal)));
keyModal?.addEventListener('click', e => { if (e.target === keyModal) closeModal(keyModal); });

document.getElementById('save-apikey-btn')?.addEventListener('click', async () => {
  const errEl = document.getElementById('key-form-error');
  errEl.style.display = 'none';
  const name = document.getElementById('key-name').value.trim();
  const role = document.getElementById('key-role').value;
  if (!name) { errEl.textContent = 'Name required.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('save-apikey-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const data = await ApiKeys.create({ name, role });
    const keyEl = document.getElementById('key-value');
    const copyBtn = document.querySelector('#apikey-modal [data-copy]');
    if (keyEl) keyEl.textContent = data.key;
    if (copyBtn) copyBtn.setAttribute('data-copy', data.key);
    document.getElementById('key-result').style.display = 'block';
    btn.style.display = 'none';
    Toast.success('API key created');
    await loadApiKeys();
  } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Create Key'; }
});

window.revokeKey = async (id, name) => {
  const ok = await confirm(`Revoke API key "${name}"? Any integrations using it will break.`, { danger: true, confirmText: 'Revoke' });
  if (!ok) return;
  try { await ApiKeys.revoke(id); Toast.success('Key revoked'); await loadApiKeys(); }
  catch (err) { Toast.error(err.message); }
};

// ══ DELIVERY LOG ══════════════════════════════════════════════════════════════

async function loadDeliveries() {
  const tbody = document.getElementById('deliveries-tbody');
  if (!tbody) return;
  try {
    const data = await Notifications.listDeliveries();
    const list = data.deliveries ?? [];
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:var(--text-muted)">No deliveries yet.</td></tr>`; return; }
    tbody.innerHTML = list.map(d => `
      <tr>
        <td class="td-mono" style="font-size:0.75rem">${fmtDateTime(d.created_at)}</td>
        <td><span class="tag">${esc(d.event_type)}</span></td>
        <td style="font-size:0.8125rem">${esc(d.channel_name ?? '—')} <span style="color:var(--text-muted)">(${esc(d.channel_type ?? '—')})</span></td>
        <td>${d.status === 'sent' ? '<span class="badge badge--success">Sent</span>' : d.status === 'failed' ? '<span class="badge badge--danger">Failed</span>' : '<span class="badge badge--muted">Suppressed</span>'}</td>
        <td style="font-size:0.75rem;color:var(--color-danger);max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(d.error ?? '')}</td>
      </tr>`).join('');
  } catch (err) { Toast.error(err.message); }
}

// ── Shared modal close ─────────────────────────────────────────────────────────
function closeModal(el) {
  el?.classList.remove('modal-backdrop--open');
  document.body.classList.remove('modal-open');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop--open').forEach(m => closeModal(m));
  }
});

// ── Load first tab ─────────────────────────────────────────────────────────────
await loadChannels();
