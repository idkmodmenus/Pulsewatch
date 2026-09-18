/**
 * PulseWatch — auth.js
 * Session management. Checks auth state, redirects unauthenticated users,
 * provides current user/org to the rest of the app.
 */

'use strict';

import { Auth, ApiError } from './api.js';

const LOGIN_PAGE  = '/login.html';
const DASHBOARD   = '/index.html';

// ─── In-memory cache ──────────────────────────────────────────────────────────
let _principal = null;
let _org       = null;

export function getPrincipal() { return _principal; }
export function getOrg()       { return _org; }

// ─── Require auth ─────────────────────────────────────────────────────────────
// Call this at the top of every protected page.
// Returns { principal, org } or redirects to login.
export async function requireAuth() {
  if (_principal) return { principal: _principal, org: _org };
  try {
    const data = await Auth.me();
    _principal = data.principal;
    _org       = data.organization;
    return { principal: _principal, org: _org };
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirectToLogin();
      return null;
    }
    // Network error — still try to show the page with offline state
    return null;
  }
}

// ─── Redirect helpers ─────────────────────────────────────────────────────────
export function redirectToLogin() {
  const current = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `${LOGIN_PAGE}?next=${current}`;
}

export function redirectToDashboard() {
  const next = new URLSearchParams(window.location.search).get('next');
  window.location.href = next ? decodeURIComponent(next) : DASHBOARD;
}

// ─── Login / Register / Logout ────────────────────────────────────────────────
export async function login(email, password) {
  const data = await Auth.login(email, password);
  _principal = data.user;
  return data;
}

export async function register(email, password, name, organization) {
  const data = await Auth.register(email, password, name, organization);
  _principal = data.user;
  _org       = data.organization;
  return data;
}

export async function logout() {
  try { await Auth.logout(); } catch {}
  _principal = null;
  _org       = null;
  window.location.href = LOGIN_PAGE;
}

// ─── Populate user UI elements ────────────────────────────────────────────────
export function populateUserUI() {
  if (!_principal) return;
  const nameEls = document.querySelectorAll('[data-user-name]');
  nameEls.forEach(el => { el.textContent = _principal.name ?? _principal.email ?? ''; });
  const emailEls = document.querySelectorAll('[data-user-email]');
  emailEls.forEach(el => { el.textContent = _principal.email ?? ''; });
  const orgEls = document.querySelectorAll('[data-org-name]');
  if (_org) orgEls.forEach(el => { el.textContent = _org.name ?? ''; });
  const avatarEls = document.querySelectorAll('[data-user-avatar]');
  avatarEls.forEach(el => {
    const initials = (_principal.name ?? _principal.email ?? '?').slice(0, 2).toUpperCase();
    el.textContent = initials;
  });
}

// ─── Role checks ─────────────────────────────────────────────────────────────
const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function hasRole(minRole) {
  if (!_principal) return false;
  const rank = ROLE_RANK[_principal.role ?? 'viewer'] ?? 0;
  return rank >= (ROLE_RANK[minRole] ?? 0);
}

export function showForRole(minRole) {
  if (!hasRole(minRole)) {
    document.querySelectorAll(`[data-min-role="${minRole}"]`).forEach(el => el.remove());
  }
}
