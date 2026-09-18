/**
 * PulseWatch — status-pages.js
 * Drives status-pages.html: list, create, update, delete status pages.
 */

'use strict';

import { requireAuth, populateUserUI, logout } from './auth.js';
import { StatusPages, Monitors } from './api.js';
import { initSidebar, initGlobalSearch, initDropdowns, Toast, emptyState, confirm } from './components.js';
import { esc, fmtDate, timeAgo } from './utils.js';

await requireAuth();
populateUserUI();
initSidebar();
initGlobalSearch();
initDropdowns();
document.getElementById('logout-btn')?.addEventListener('click', () => logout());

// ── State ──────────────────────────────────────────────────────────────────────
let pages    = [];
let monitors = [];
let editingId = null;

// ── Load ───────────────────────────────────────────────────────────────────────
async function load() {
  try {
    const [pData, mData] = await Promise.all([StatusPages.list(), Monitors.list()]);
    pages    = pData.pages    ?? [];
    monitors = mData.monitors ?? [];
    renderGrid(pages);
  } catch (err) {
    Toast.error('Failed to load status pages: ' + err.message);
  }
}

// ── Grid ───────────────────────────────────────────────────────────────────────
function renderGrid(pages) {
  const grid = document.getElementById('status-pages-grid');
  if (!grid) return;
  if (!pages.length) {
    grid.innerHTML = emptyState({
      title:   'No status pages yet',
      message: 'Create a public status page to communicate your service health to users.',
      action:  '<button class="btn btn--primary btn--sm" id="create-page-btn-empty">Create Status Page</button>',
    });
    document.getElementById('create-page-btn-empty')?.addEventListener('click', openCreateModal);
    return;
  }
  grid.innerHTML = pages.map(page => pageCard(page)).join('');
  grid.querySelectorAll('[data-edit-page]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.editPage); });
  });
  grid.querySelectorAll('[data-delete-page]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deletePage(btn.dataset.deletePage, btn.dataset.pageName); });
  });
  grid.querySelectorAll('[data-preview-page]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); previewPage(btn.dataset.previewPage); });
  });
}

function pageCard(p) {
  const pubUrl = `/api/public/status-pages/${esc(p.slug)}`;
  return `
  <div class="card">
    <div class="card__header">
      <span class="card__title">${esc(p.title)}</span>
      <div style="display:flex;gap:0.375rem">
        ${p.is_public ? '<span class="badge badge--success">Public</span>' : '<span class="badge badge--muted">Private</span>'}
      </div>
    </div>
    <div class="card__body" style="display:flex;flex-direction:column;gap:0.625rem">
      <div style="font-size:0.8125rem;color:var(--text-muted)">
        <span>Slug: </span><code style="font-size:0.8125rem">${esc(p.slug)}</code>
      </div>
      ${p.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary)">${esc(p.description)}</p>` : ''}
      <div style="font-size:0.75rem;color:var(--text-muted)">${p.monitor_count ?? 0} monitors · Created ${fmtDate(p.created_at)}</div>
      <div style="display:flex;gap:0.5rem;margin-top:0.25rem">
        <button class="btn btn--ghost btn--sm" data-preview-page="${esc(p.slug)}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
          Preview
        </button>
        <button class="btn btn--ghost btn--sm" data-edit-page="${esc(p.id)}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg>
          Edit
        </button>
        <button class="btn btn--danger btn--sm" data-delete-page="${esc(p.id)}" data-page-name="${esc(p.title)}">Delete</button>
      </div>
    </div>
  </div>`;
}

// ── Preview ───────────────────────────────────────────────────────────────────
async function previewPage(slug) {
  try {
    const data = await StatusPages.getPublic(slug);
    showPublicPreview(data);
  } catch (err) { Toast.error('Could not load preview: ' + err.message); }
}

function showPublicPreview(data) {
  const overall = data.overall;
  const clr = overall === 'operational' ? 'var(--color-success)' : overall === 'degraded' ? 'var(--color-warn)' : 'var(--color-danger)';
  const overallText = overall === 'operational' ? 'All Systems Operational'
    : overall === 'degraded' ? 'Partial System Degradation' : 'Major Outage';

  const services = (data.services ?? []).map(s => {
    const cls = s.status === 'up' ? 'badge--success' : s.status === 'degraded' ? 'badge--warn' : 'badge--danger';
    const label = s.status === 'up' ? 'Operational' : s.status === 'degraded' ? 'Degraded' : 'Outage';
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 0;border-bottom:1px solid var(--border)">
      <span style="font-size:0.875rem;font-weight:500;color:var(--text-primary)">${esc(s.name)}</span>
      <span class="badge ${cls}">${label}</span>
    </div>`;
  }).join('');

  const html = `
    <div style="text-align:center;padding:1.5rem 0 1rem">
      <div style="font-size:2rem;margin-bottom:0.5rem">${overall === 'operational' ? '✅' : overall === 'degraded' ? '⚠️' : '🔴'}</div>
      <h2 style="color:${clr};font-size:1.125rem;font-weight:700">${overallText}</h2>
    </div>
    <div>${services || '<div style="text-align:center;color:var(--text-muted);padding:1rem">No services configured</div>'}</div>`;

  // Use a simple modal
  const { Modal } = import('./components.js');
  // Build inline since we have a simple case
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop modal-backdrop--open';
  backdrop.innerHTML = `
    <div class="modal modal--md">
      <div class="modal__header">
        <h2 class="modal__title">${esc(data.page?.title ?? 'Status Page Preview')}</h2>
        <button class="modal__close">&times;</button>
      </div>
      <div class="modal__body">${html}</div>
    </div>`;
  backdrop.querySelector('.modal__close').addEventListener('click', () => { backdrop.remove(); document.body.classList.remove('modal-open'); });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.remove(); document.body.classList.remove('modal-open'); } });
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
}

// ── Create / edit modal ────────────────────────────────────────────────────────
const modal = document.getElementById('create-page-modal');
function openCreateModal() {
  editingId = null;
  document.getElementById('sp-modal-title').textContent = 'Create Status Page';
  document.getElementById('save-page-btn').textContent = 'Create Page';
  document.getElementById('sp-title').value  = '';
  document.getElementById('sp-slug').value   = '';
  document.getElementById('sp-desc').value   = '';
  document.getElementById('sp-public').checked = true;
  document.getElementById('sp-form-error').style.display = 'none';
  renderMonitorChecklist([]);
  openModal();
}

async function openEditModal(id) {
  editingId = id;
  document.getElementById('sp-modal-title').textContent = 'Edit Status Page';
  document.getElementById('save-page-btn').textContent  = 'Save Changes';
  document.getElementById('sp-form-error').style.display = 'none';
  openModal();
  try {
    const data = await StatusPages.get(id);
    const p = data.page;
    const pageMons = (data.monitors ?? []).map(m => m.monitor_id);
    document.getElementById('sp-title').value   = p.title ?? '';
    document.getElementById('sp-slug').value    = p.slug  ?? '';
    document.getElementById('sp-desc').value    = p.description ?? '';
    document.getElementById('sp-public').checked = p.is_public ?? true;
    renderMonitorChecklist(pageMons);
  } catch (err) {
    Toast.error('Failed to load page: ' + err.message);
  }
}

function openModal()  { modal?.classList.add('modal-backdrop--open');  document.body.classList.add('modal-open');  }
function closeModal() { modal?.classList.remove('modal-backdrop--open'); document.body.classList.remove('modal-open'); }

document.getElementById('create-page-btn')?.addEventListener('click', openCreateModal);
modal?.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', closeModal));
modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Auto-slug from title
document.getElementById('sp-title')?.addEventListener('input', e => {
  const slugEl = document.getElementById('sp-slug');
  if (slugEl && !editingId) {
    slugEl.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  }
});

function renderMonitorChecklist(selected = []) {
  const el = document.getElementById('sp-monitors-list');
  if (!el) return;
  if (!monitors.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem">No monitors available.</div>'; return; }
  el.innerHTML = monitors.map(m => `
    <label style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem;border-radius:var(--radius-sm);cursor:pointer;transition:background var(--t-fast)" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
      <input type="checkbox" value="${esc(m.id)}" ${selected.includes(m.id) ? 'checked' : ''} style="accent-color:var(--color-accent)" />
      <span style="font-size:0.8125rem;color:var(--text-primary)">${esc(m.name)}</span>
      <span style="margin-left:auto">${typeTag(m.type)}</span>
    </label>`).join('');
}

document.getElementById('save-page-btn')?.addEventListener('click', async () => {
  const errEl = document.getElementById('sp-form-error');
  errEl.style.display = 'none';
  const title    = document.getElementById('sp-title').value.trim();
  const slug     = document.getElementById('sp-slug').value.trim();
  const desc     = document.getElementById('sp-desc').value.trim();
  const isPublic = document.getElementById('sp-public').checked;
  const checked  = [...document.querySelectorAll('#sp-monitors-list input[type=checkbox]:checked')].map(i => ({ monitorId: i.value, group: 'Services' }));

  if (!title) { errEl.textContent = 'Title is required.'; errEl.style.display = 'block'; return; }
  if (!editingId && !slug) { errEl.textContent = 'Slug is required.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('save-page-btn');
  btn.disabled = true; btn.textContent = editingId ? 'Saving…' : 'Creating…';
  try {
    if (editingId) {
      await StatusPages.update(editingId, { title, description: desc, isPublic, monitors: checked });
      Toast.success('Status page updated');
    } else {
      await StatusPages.create({ title, slug, description: desc, isPublic, monitors: checked });
      Toast.success('Status page created');
    }
    closeModal();
    await load();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = editingId ? 'Save Changes' : 'Create Page';
  }
});

// ── Delete ─────────────────────────────────────────────────────────────────────
async function deletePage(id, name) {
  const ok = await confirm(`Delete "${name}"?`, { danger: true, confirmText: 'Delete' });
  if (!ok) return;
  try {
    await StatusPages.delete(id);
    Toast.success('Status page deleted');
    await load();
  } catch (err) { Toast.error(err.message); }
}

await load();
